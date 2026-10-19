// Worker: serves the game, and runs one Durable Object per online room.
// The host's browser runs the physics. The room owns the lobby (who is in,
// what they picked, whether a fight started or finished), answers every join
// with the whole lobby, and relays the match stream between the two seats.
import { DurableObject } from 'cloudflare:workers';
import { Lobby, Role, ClientMsg, ServerMsg, emptyLobby, join, leave, pick, start, over } from '../net/lobby';

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<Room>;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/room\/([A-Z0-9]{4,8})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      return stub.fetch(req);
    }
    if (url.pathname.startsWith('/api/')) return new Response('not found', { status: 404 });
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

interface Attachment { role: Role | null; clientId: string | null; joinedAt?: number }

/** a seated socket with no ping for this long is dead (sleep, Wi-Fi drop): close it so the other side sees it go */
const DEAD_MS = 9000;
const SWEEP_MS = 3000;

export class Room extends DurableObject<Env> {
  private lobby: Lobby = emptyLobby();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // pings are answered without waking the room (or costing a request)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    // the lobby survives the room being evicted between messages
    ctx.blockConcurrencyWhile(async () => {
      this.lobby = (await ctx.storage.get<Lobby>('lobby')) ?? emptyLobby();
      // whoever is actually connected right now, regardless of what was stored
      for (const role of ['host', 'guest'] as const) this.lobby[role].connected = this.live(role).length > 0;
    });
  }

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    // the seat is claimed by the join message, not the URL, so a join can be retried on the same socket
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ role: null, clientId: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private att(ws: WebSocket): Attachment {
    return (ws.deserializeAttachment() as Attachment | null) ?? { role: null, clientId: null };
  }
  private live(role: Role, except?: WebSocket) {
    return this.ctx.getWebSockets().filter((w) => w !== except && this.att(w).role === role);
  }
  private send(ws: WebSocket, m: ServerMsg | string) {
    try { ws.send(typeof m === 'string' ? m : JSON.stringify(m)); } catch { /* gone */ }
  }
  private async commit(next: Lobby) {
    this.lobby = next;
    await this.ctx.storage.put('lobby', next);
    for (const ws of this.ctx.getWebSockets()) if (this.att(ws).role) this.send(ws, { t: 'lobby', lobby: next });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string') return;
    const me = this.att(ws);
    // the match stream is relayed untouched (and never parsed): snapshots host->guest, input guest->host
    if (raw.startsWith('{"t":"s"') || raw.startsWith('{"t":"i"')) {
      if (!me.role) return this.send(ws, { t: 'error', msg: 'bad request' });
      for (const peer of this.live(me.role === 'host' ? 'guest' : 'host')) this.send(peer, raw);
      return;
    }
    let msg: ClientMsg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'join') {
      const others = this.live(msg.role, ws);
      const occupant = others.length ? this.att(others[0]).clientId : null;
      const r = join(this.lobby, msg, occupant);
      if (!r.ok) return this.send(ws, { t: 'error', msg: r.error });
      // a reconnect from the same client replaces its old socket
      for (const old of others) { try { old.serializeAttachment({ role: null, clientId: null }); old.close(4000, 'replaced'); } catch { /* gone */ } }
      ws.serializeAttachment({ role: msg.role, clientId: msg.clientId, joinedAt: Date.now() } satisfies Attachment);
      await this.commit(r.lobby);
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
      this.send(ws, { t: 'welcome', role: msg.role, lobby: this.lobby });
      return;
    }
    if (!me.role) return; // must join first
    const next = msg.t === 'pick' ? pick(this.lobby, me.role, msg)
      : msg.t === 'start' ? start(this.lobby, me.role, msg)
      : msg.t === 'over' ? over(this.lobby, me.role, msg)
      : null;
    if (next) await this.commit(next);
  }

  /** dead-socket sweep: a client that vanished without a close frame never fires webSocketClose */
  async alarm() {
    const now = Date.now();
    let seated = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws);
      if (!a.role) continue;
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      if (now - Math.max(lastPing, a.joinedAt ?? 0) > DEAD_MS) {
        try { ws.close(4001, 'no ping'); } catch { /* gone */ }
        await this.drop(ws);
      } else seated++;
    }
    if (seated) await this.ctx.storage.setAlarm(now + SWEEP_MS);
  }

  async webSocketClose(ws: WebSocket) { await this.drop(ws); }
  async webSocketError(ws: WebSocket) { await this.drop(ws); }

  private async drop(ws: WebSocket) {
    const { role } = this.att(ws);
    if (!role) return;
    ws.serializeAttachment({ role: null, clientId: null });
    if (this.live(role, ws).length === 0) await this.commit(leave(this.lobby, role));
  }
}
