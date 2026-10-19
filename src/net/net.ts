// Online play: the host's browser runs the physics and streams the match
// view at 30 Hz through a Durable Object room; the guest renders it
// (interpolated) and streams its stick back. Designs travel as JSON with
// Infinity encoded, so unlimited actuators survive the trip.
import * as THREE from 'three';
import { GameSession, FrameInfo } from '../game';
import { GameView } from '../render/scene';
import { Audio } from '../audio/audio';
import { BotDesign } from '../sim/design';
import { BotInput, NO_INPUT } from '../sim/bot';
import { MatchResult, MatchView } from '../sim/match';
import { SimEvent } from '../sim/combat';
import { HumanDriver, ControllerKind } from '../input';
import { ClientMsg, Lobby, PROTOCOL, Role, ServerMsg, backoff } from './lobby';

export const encode = (x: unknown) => JSON.stringify(x, (_k, v) => (v === Infinity ? '∞' : typeof v === 'number' ? Math.round(v * 10000) / 10000 : v));
export const decode = <T>(s: string): T => JSON.parse(s, (_k, v) => (v === '∞' ? Infinity : v));

export interface BotSummary { damageDealt: number; bigHits: number; hazardDamageDealt: number; aggression: number; whUsed: number; armor: number }

type Relay =
  | { t: 's'; v: MatchView; e: SimEvent[]; x: { slide: number[]; secondary: number[]; flame: boolean[] } }
  | { t: 'i'; i: BotInput };
type Msg = Relay | ClientMsg;

export function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

function socketUrl(code: string) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/room/${code}`;
}

/** one id per tab and seat, so a reconnect reclaims its seat and a second tab can't steal it */
function clientIdFor(code: string, role: Role) {
  const key = `killsaws.client.${code}.${role}`;
  try {
    const have = sessionStorage.getItem(key);
    if (have) return have;
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(key, id);
    return id;
  } catch { return Math.random().toString(36).slice(2); }
}

/**
 * A seat in a room. Every (re)connect sends the cached join and gets a welcome with the whole lobby
 * back, so a pick made while the other side was away, a FIGHT pressed during a blip, or a result
 * that landed while reconnecting are never lost. Pings are answered by the room without waking it;
 * a silent socket is closed and redialled with backoff + jitter.
 */
class Peer {
  ws: WebSocket | null = null;
  lobby: Lobby | null = null;
  joined = false;
  onLobby: (l: Lobby) => void = () => {};
  onRelay: (m: Relay) => void = () => {};
  onStatus: (s: string) => void = () => {};
  private closed = false;
  private fatal = false;
  private attempts = 0;
  private lastPong = 0;
  private pinger = 0;
  private clientId: string;
  private name = '';
  private design: unknown | null = null;
  constructor(readonly code: string, readonly role: Role) {
    this.clientId = clientIdFor(code, role);
    this.connect();
  }
  private connect() {
    const ws = new WebSocket(socketUrl(this.code));
    this.ws = ws;
    this.joined = false;
    this.onStatus(this.attempts ? 'Reconnecting…' : 'Connecting…');
    ws.onopen = () => {
      this.lastPong = performance.now();
      ws.send(encode({ t: 'join', role: this.role, clientId: this.clientId, name: this.name, design: this.design, v: PROTOCOL } satisfies ClientMsg));
      clearInterval(this.pinger);
      this.pinger = window.setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // no pong for 6 s: the socket is half-open (sleep, Wi-Fi handoff). Drop it and redial.
        if (performance.now() - this.lastPong > 6000) { try { ws.close(); } catch { /* gone */ } return; }
        ws.send('ping');
      }, 2000);
    };
    ws.onmessage = (ev) => {
      const data = String(ev.data);
      if (data === 'pong') { this.lastPong = performance.now(); return; }
      this.lastPong = performance.now();
      const m = decode<ServerMsg | Relay>(data);
      if (m.t === 'welcome') { this.joined = true; this.attempts = 0; this.lobby = m.lobby; this.onLobby(m.lobby); return; }
      if (m.t === 'lobby') { this.lobby = m.lobby; this.onLobby(m.lobby); return; }
      if (m.t === 'error') {
        if (m.msg === 'update') { this.fatal = true; this.onStatus('This page is out of date. Refresh to play online.'); }
        else if (m.msg === 'room full') { this.fatal = true; this.onStatus('That room already has two players.'); }
        return;
      }
      this.onRelay(m);
    };
    ws.onclose = () => {
      clearInterval(this.pinger);
      if (this.ws !== ws || this.closed || this.fatal) return;
      this.onStatus('Connection dropped. Reconnecting…');
      setTimeout(() => this.connect(), backoff(this.attempts++));
    };
  }
  /** stored by the room, and re-sent with every join */
  setPick(name: string, design: unknown | null) {
    this.name = name;
    this.design = design;
    this.send({ t: 'pick', name, design });
  }
  send(m: Msg) { if (this.ws?.readyState === WebSocket.OPEN && (this.joined || m.t === 'join')) this.ws.send(encode(m)); }
  close() { this.closed = true; clearInterval(this.pinger); this.ws?.close(); }
}

const seatStatus = (l: Lobby | null, other: Role, waiting: string) =>
  !l ? 'Connecting…' : l[other].connected ? 'Opponent connected.' : waiting;

export class NetHost {
  peer: Peer;
  private session: GameSession | null = null;
  private acc = 0;
  private pending: SimEvent[] = [];
  onChange: () => void = () => {};
  status = '';
  constructor(readonly code: string) {
    this.peer = new Peer(code, 'host');
    this.peer.onStatus = (s) => { this.status = s; this.onChange(); };
    this.peer.onLobby = (l) => { this.status = seatStatus(l, 'guest', 'Room open. Waiting for your opponent…'); this.onChange(); };
    this.peer.onRelay = (m) => { if (m.t === 'i' && this.session) this.session.remoteInput = m.i; };
  }
  get guestDesign() { return (this.peer.lobby?.guest.design as BotDesign | null) ?? null; }
  get guestName() { return this.peer.lobby?.guest.name ?? ''; }
  get guestHere() { return !!this.peer.lobby?.guest.connected; }
  setPick(design: BotDesign | null, name: string) { this.peer.setPick(name, design); }
  start(designs: [BotDesign, BotDesign]) { this.peer.send({ t: 'start', designs }); }
  attach(s: GameSession) {
    this.session = s;
    s.remoteInput = { ...NO_INPUT };
    s.onEvents = (evs) => { for (const e of evs) if (e.type !== 'hit' || e.energy > 150 || e.kind !== 'hazard') this.pending.push(e); };
    const prevFrame = s.onTick;
    s.onTick = (view, dt) => {
      prevFrame?.(view, dt);
      this.acc += dt;
      if (this.acc < 1 / 30 && !view.result) return;
      this.acc = 0;
      const m = s.match;
      this.peer.send({ t: 's', v: view, e: this.pending.splice(0, 200), x: { slide: m.bots.map((b) => b.slidePos), secondary: m.bots.map((b) => b.secondaryAct?.pos ?? 0), flame: m.bots.map((b) => b.flameOn) } });
      if (view.result && !this.sentOver) {
        this.sentOver = true;
        // stored by the room, so a guest reconnecting after the buzzer still gets the results
        this.peer.send({ t: 'over', result: view.result, summary: summarize(s) });
      }
    };
    this.sentOver = false;
  }
  private sentOver = false;
  close() { this.peer.close(); if (this.session) { this.session.onTick = undefined; this.session.onEvents = () => {}; } }
}

export function summarize(s: GameSession): BotSummary[] {
  return s.match.bots.map((b) => ({
    damageDealt: b.damageDealt, bigHits: b.bigHits, hazardDamageDealt: b.hazardDamageDealt, aggression: b.aggression, whUsed: b.whUsed,
    armor: Math.round((Object.values(b.panels).reduce((x, p) => x + p.integrity, 0) / 6) * 100),
  }));
}

/** Guest: renders the host's stream with interpolation and sends input. */
export class NetGuest {
  peer: Peer;
  status = '';
  onChange: () => void = () => {};
  onStart: (d: [BotDesign, BotDesign]) => void = () => {};
  onFrame: (f: FrameInfo) => void = () => {};
  onResult: (r: MatchResult, s: BotSummary[]) => void = () => {};
  private snaps: { at: number; v: MatchView; x: { slide: number[]; secondary: number[]; flame: boolean[] } }[] = [];
  private raf = 0;
  private driver: HumanDriver;
  private view: GameView | null = null;
  private audio: Audio | null = null;
  private lastSend = 0;
  private last = 0;
  private wAngle = [0, 0];
  private startedSeq = 0;
  private overSeq = 0;
  constructor(readonly code: string, kind: ControllerKind = 'kb1') {
    this.driver = new HumanDriver(kind);
    this.peer = new Peer(code, 'guest');
    this.peer.onStatus = (s) => { this.status = s; this.onChange(); };
    this.peer.onLobby = (l) => {
      this.status = seatStatus(l, 'host', 'Waiting for the host…');
      // a fight that started (or finished) while we were connecting or reconnecting still reaches us
      if (l.started && l.started.seq !== this.startedSeq && (!l.over || l.over.seq !== l.started.seq)) {
        this.startedSeq = l.started.seq;
        this.onStart(l.started.designs as [BotDesign, BotDesign]);
      }
      if (l.over && l.over.seq !== this.overSeq && l.over.seq === this.startedSeq) {
        this.overSeq = l.over.seq;
        this.onResult(l.over.result as MatchResult, l.over.summary as BotSummary[]);
      }
      this.onChange();
    };
    this.peer.onRelay = (m) => {
      if (m.t !== 's') return;
      this.snaps.push({ at: performance.now(), v: m.v, x: m.x });
      if (this.snaps.length > 6) this.snaps.shift();
      if (this.view) {
        this.view.events(m.e);
        this.audio?.events(m.e, m.v);
      }
    };
  }
  get hostDesign() { return (this.peer.lobby?.host.design as BotDesign | null) ?? null; }
  get hostName() { return this.peer.lobby?.host.name ?? ''; }
  setPick(design: BotDesign, name: string) { this.peer.setPick(name, design); }

  /** take over the renderer for the match */
  play(view: GameView, audio: Audio, designs: [BotDesign, BotDesign]) {
    cancelAnimationFrame(this.raf); // a rematch replaces the previous fight's loop
    this.view = view;
    this.audio = audio;
    this.snaps = [];
    view.setBots(designs);
    view.focus = 1;
    audio.startMatch(designs);
    this.last = performance.now();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      // input at ~60 Hz
      const inp = this.driver.read(dt);
      if (now - this.lastSend > 16) { this.peer.send({ t: 'i', i: inp }); this.lastSend = now; }
      const v = this.interpolated(now - 80, dt);
      if (!v) { view.frame(dt); return; }
      if (!view.arena) return;
      view.apply(v.v, v.x);
      view.frame(dt, v.x.flame);
      this.onFrame({ view: v.v, inputs: [NO_INPUT, inp], slowmo: false });
    };
    loop();
  }

  private interpolated(t: number, dt: number) {
    const s = this.snaps;
    if (!s.length) return null;
    let a = s[0], b = s[s.length - 1];
    for (let i = 0; i < s.length - 1; i++) if (s[i].at <= t && s[i + 1].at >= t) { a = s[i]; b = s[i + 1]; break; }
    const k = b.at === a.at ? 1 : Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at)));
    const v: MatchView = structuredClone(b.v);
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    v.bots.forEach((bv, i) => {
      const av = a.v.bots[i];
      bv.pos = { x: av.pos.x + (bv.pos.x - av.pos.x) * k, y: av.pos.y + (bv.pos.y - av.pos.y) * k, z: av.pos.z + (bv.pos.z - av.pos.z) * k };
      qa.set(av.rot.x, av.rot.y, av.rot.z, av.rot.w); qb.set(bv.rot.x, bv.rot.y, bv.rot.z, bv.rot.w);
      qa.slerp(qb, k);
      bv.rot = { x: qa.x, y: qa.y, z: qa.z, w: qa.w };
      // spin the rotor locally from its rpm so 30 Hz updates don't strobe it
      this.wAngle[i] += (bv.rpm * Math.PI * 2 / 60) * dt;
      bv.weaponAngle = this.wAngle[i];
    });
    return { v, x: b.x };
  }

  close() { cancelAnimationFrame(this.raf); this.peer.close(); this.audio?.stopMatch(); }
}
