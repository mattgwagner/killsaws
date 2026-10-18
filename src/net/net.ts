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

export const encode = (x: unknown) => JSON.stringify(x, (_k, v) => (v === Infinity ? '∞' : typeof v === 'number' ? Math.round(v * 10000) / 10000 : v));
export const decode = <T>(s: string): T => JSON.parse(s, (_k, v) => (v === '∞' ? Infinity : v));

export interface BotSummary { damageDealt: number; bigHits: number; hazardDamageDealt: number; aggression: number; whUsed: number; armor: number }

type Msg =
  | { t: 'peer'; role: 'host' | 'guest'; present: boolean }
  | { t: 'pick'; design: BotDesign; name: string }
  | { t: 'lobby'; host: BotDesign | null; guest: BotDesign | null }
  | { t: 'start'; designs: [BotDesign, BotDesign] }
  | { t: 's'; v: MatchView; e: SimEvent[]; x: { slide: number[]; secondary: number[]; flame: boolean[] } }
  | { t: 'i'; i: BotInput }
  | { t: 'over'; result: MatchResult; summary: BotSummary[] }
  | { t: 'chat'; text: string };

export function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

function socketUrl(code: string, role: 'host' | 'guest') {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/room/${code}?role=${role}`;
}

class Peer {
  ws: WebSocket | null = null;
  peerPresent = false;
  onMsg: (m: Msg) => void = () => {};
  onStatus: (s: string) => void = () => {};
  private closed = false;
  constructor(readonly code: string, readonly role: 'host' | 'guest') { this.connect(); }
  private connect() {
    const ws = new WebSocket(socketUrl(this.code, this.role));
    this.ws = ws;
    ws.onopen = () => this.onStatus(this.role === 'host' ? 'Room open. Waiting for your opponent…' : 'Connected. Waiting for the host…');
    ws.onmessage = (ev) => {
      const m = decode<Msg>(String(ev.data));
      if (m.t === 'peer') { this.peerPresent = m.present; this.onStatus(m.present ? 'Opponent connected.' : 'Opponent left.'); }
      this.onMsg(m);
    };
    ws.onclose = () => { if (!this.closed) { this.onStatus('Connection dropped. Reconnecting…'); setTimeout(() => this.connect(), 1500); } };
  }
  send(m: Msg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(m)); }
  close() { this.closed = true; this.ws?.close(); }
}

export class NetHost {
  peer: Peer;
  guestDesign: BotDesign | null = null;
  guestName = '';
  private session: GameSession | null = null;
  private acc = 0;
  private pending: SimEvent[] = [];
  onChange: () => void = () => {};
  status = '';
  constructor(readonly code: string) {
    this.peer = new Peer(code, 'host');
    this.peer.onStatus = (s) => { this.status = s; this.onChange(); };
    this.peer.onMsg = (m) => {
      if (m.t === 'pick') { this.guestDesign = m.design; this.guestName = m.name; this.onChange(); }
      if (m.t === 'i' && this.session) this.session.remoteInput = m.i;
    };
  }
  lobby(host: BotDesign | null) { this.peer.send({ t: 'lobby', host, guest: this.guestDesign }); }
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
  lobby: { host: BotDesign | null; guest: BotDesign | null } = { host: null, guest: null };
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
  constructor(readonly code: string, kind: ControllerKind = 'kb1') {
    this.driver = new HumanDriver(kind);
    this.peer = new Peer(code, 'guest');
    this.peer.onStatus = (s) => { this.status = s; this.onChange(); };
    this.peer.onMsg = (m) => {
      if (m.t === 'lobby') { this.lobby = { host: m.host, guest: m.guest }; this.onChange(); }
      if (m.t === 'start') this.onStart(m.designs);
      if (m.t === 's') {
        this.snaps.push({ at: performance.now(), v: m.v, x: m.x });
        if (this.snaps.length > 6) this.snaps.shift();
        if (this.view) {
          this.view.events(m.e);
          this.audio?.events(m.e, m.v);
        }
      }
      if (m.t === 'over') this.onResult(m.result, m.summary);
    };
  }
  pick(design: BotDesign, name: string) { this.peer.send({ t: 'pick', design, name }); }

  /** take over the renderer for the match */
  play(view: GameView, audio: Audio, designs: [BotDesign, BotDesign]) {
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
