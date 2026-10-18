// Worker: serves the game, and relays online matches through one Durable
// Object per room. The host's browser runs the physics; the room only relays.
import { DurableObject } from 'cloudflare:workers';

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

export class Room extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest';
    const existing = this.ctx.getWebSockets(role);
    if (existing.length) {
      // newest connection wins the seat (reconnects)
      for (const ws of existing) try { ws.close(4000, 'replaced'); } catch { /* gone */ }
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [role]);
    const other = this.ctx.getWebSockets(role === 'host' ? 'guest' : 'host');
    for (const ws of other) ws.send(JSON.stringify({ t: 'peer', role, present: true }));
    if (other.length) pair[1].send(JSON.stringify({ t: 'peer', role: role === 'host' ? 'guest' : 'host', present: true }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    const [role] = this.ctx.getTags(ws);
    for (const peer of this.ctx.getWebSockets(role === 'host' ? 'guest' : 'host')) {
      try { peer.send(msg); } catch { /* peer gone */ }
    }
  }

  webSocketClose(ws: WebSocket) {
    const [role] = this.ctx.getTags(ws);
    for (const peer of this.ctx.getWebSockets(role === 'host' ? 'guest' : 'host')) {
      try { peer.send(JSON.stringify({ t: 'peer', role, present: false })); } catch { /* gone */ }
    }
  }
}
