// The room's lobby, shared by the Durable Object (which owns it) and the
// clients (which render it). Pure and DOM-free so it unit-tests and runs in
// the Worker. Designs are opaque JSON to the server.
//
// Joining is a request the server always answers: every (re)connect sends a
// cached `join`, the server replies `welcome` with the whole lobby (including
// a fight already started or finished), and picks are stored, not relayed, so
// nothing sent while the other side is away is ever lost.

export const PROTOCOL = 2;
export type Role = 'host' | 'guest';

export interface Seat {
  name: string;
  design: unknown | null;
  connected: boolean;
}

export interface Lobby {
  host: Seat;
  guest: Seat;
  /** set when the host presses FIGHT; seq lets a client start each fight exactly once */
  started: { designs: [unknown, unknown]; seq: number } | null;
  /** the last finished fight's result, so a reconnecting guest still gets the results screen */
  over: { result: unknown; summary: unknown; seq: number } | null;
  seq: number;
}

export type ClientMsg =
  | { t: 'join'; role: Role; clientId: string; name: string; design: unknown | null; v: number }
  | { t: 'pick'; name: string; design: unknown | null }
  | { t: 'start'; designs: [unknown, unknown] }
  | { t: 'over'; result: unknown; summary: unknown };

export type ServerMsg =
  | { t: 'welcome'; role: Role; lobby: Lobby }
  | { t: 'lobby'; lobby: Lobby }
  | { t: 'error'; msg: 'update' | 'room full' | 'bad request' };

export const emptySeat = (): Seat => ({ name: '', design: null, connected: false });
export const emptyLobby = (): Lobby => ({ host: emptySeat(), guest: emptySeat(), started: null, over: null, seq: 0 });

/**
 * A client asks for a seat. `occupant` is the clientId currently holding that seat on a live socket
 * (the DO reads it from socket attachments), or null if the seat is free.
 */
export function join(lobby: Lobby, msg: Extract<ClientMsg, { t: 'join' }>, occupant: string | null):
  { ok: true; lobby: Lobby } | { ok: false; error: 'update' | 'room full' } {
  if (msg.v !== PROTOCOL) return { ok: false, error: 'update' };
  // same client reconnecting (or the seat's old socket is gone): take it; someone else: room full
  if (occupant && occupant !== msg.clientId) return { ok: false, error: 'room full' };
  const seat = lobby[msg.role];
  const next: Seat = {
    connected: true,
    name: clean(msg.name) || seat.name,
    // a reconnect re-sends its cached pick; never wipe a stored pick with an empty one
    design: msg.design ?? seat.design,
  };
  return { ok: true, lobby: { ...lobby, [msg.role]: next, seq: lobby.seq + 1 } };
}

export function leave(lobby: Lobby, role: Role): Lobby {
  return { ...lobby, [role]: { ...lobby[role], connected: false }, seq: lobby.seq + 1 };
}

export function pick(lobby: Lobby, role: Role, msg: Extract<ClientMsg, { t: 'pick' }>): Lobby {
  const seat = lobby[role];
  return { ...lobby, [role]: { ...seat, name: clean(msg.name) || seat.name, design: msg.design ?? seat.design }, seq: lobby.seq + 1 };
}

/** Only the host starts a fight, and only once both robots are known. */
export function start(lobby: Lobby, role: Role, msg: Extract<ClientMsg, { t: 'start' }>): Lobby | null {
  if (role !== 'host' || !msg.designs?.[0] || !msg.designs?.[1]) return null;
  const seq = (lobby.started?.seq ?? 0) + 1;
  return { ...lobby, started: { designs: msg.designs, seq }, over: null, seq: lobby.seq + 1 };
}

export function over(lobby: Lobby, role: Role, msg: Extract<ClientMsg, { t: 'over' }>): Lobby | null {
  if (role !== 'host' || !lobby.started) return null;
  return { ...lobby, over: { result: msg.result, summary: msg.summary, seq: lobby.started.seq }, seq: lobby.seq + 1 };
}

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/[^\w .'!-]/g, '').slice(0, 16).trim() : '');

/** Reconnect delay: exponential backoff with full jitter, capped. */
export function backoff(attempt: number, rand = Math.random) {
  const cap = Math.min(8000, 400 * 2 ** attempt);
  return 250 + rand() * cap;
}
