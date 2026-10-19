// The room's lobby rules (src/net/lobby.ts): joining is idempotent and always answered,
// and nothing either side sends while the other is away is lost.
import { describe, expect, it } from 'vitest';
import { PROTOCOL, backoff, emptyLobby, join, leave, over, pick, start } from '../src/net/lobby';

const J = (role: 'host' | 'guest', clientId: string, design: unknown = null, v = PROTOCOL) => ({ t: 'join' as const, role, clientId, name: role, design, v });

describe('room lobby', () => {
  it('a guest who picks before the host arrives keeps the pick: the host sees it on its welcome', () => {
    let l = emptyLobby();
    const g = join(l, J('guest', 'g1'), null); expect(g.ok).toBe(true); if (!g.ok) return;
    l = pick(g.lobby, 'guest', { t: 'pick', name: 'Colton', design: { id: 'minotaur' } });
    const h = join(l, J('host', 'h1'), null); expect(h.ok).toBe(true); if (!h.ok) return;
    expect(h.lobby.guest.design).toEqual({ id: 'minotaur' });
    expect(h.lobby.guest.name).toBe('Colton');
    expect(h.lobby.host.connected && h.lobby.guest.connected).toBe(true);
  });

  it('joining again from the same client is idempotent and never wipes a stored pick', () => {
    let l = emptyLobby();
    const a = join(l, J('guest', 'g1', { id: 'tombstone' }), null); if (!a.ok) throw new Error();
    l = leave(a.lobby, 'guest');
    expect(l.guest.connected).toBe(false);
    const b = join(l, J('guest', 'g1', null), 'g1'); if (!b.ok) throw new Error();
    expect(b.lobby.guest.design).toEqual({ id: 'tombstone' });
    expect(b.lobby.guest.connected).toBe(true);
  });

  it('a different client cannot take an occupied seat; a stale protocol is told to update', () => {
    const l = emptyLobby();
    expect(join(l, J('guest', 'g2'), 'g1')).toEqual({ ok: false, error: 'room full' });
    expect(join(l, J('guest', 'g1', null, PROTOCOL - 1), null)).toEqual({ ok: false, error: 'update' });
  });

  it('FIGHT is stored: a guest that was reconnecting when it was pressed still starts that fight, once', () => {
    let l = emptyLobby();
    expect(start(l, 'guest', { t: 'start', designs: [{}, {}] })).toBeNull(); // only the host starts
    l = start(l, 'host', { t: 'start', designs: [{ id: 'a' }, { id: 'b' }] })!;
    l = leave(l, 'guest');
    const g = join(l, J('guest', 'g1'), null); if (!g.ok) throw new Error();
    expect(g.lobby.started?.seq).toBe(1);
    expect(g.lobby.started?.designs).toEqual([{ id: 'a' }, { id: 'b' }]);
    const again = start(g.lobby, 'host', { t: 'start', designs: [{ id: 'a' }, { id: 'b' }] })!;
    expect(again.started?.seq).toBe(2); // a rematch is a new fight
    expect(again.over).toBeNull();
  });

  it('the result is stored for the fight it belongs to', () => {
    let l = start(emptyLobby(), 'host', { t: 'start', designs: [{}, {}] })!;
    l = over(l, 'host', { t: 'over', result: { winner: 1 }, summary: [] })!;
    expect(l.over).toEqual({ result: { winner: 1 }, summary: [], seq: 1 });
    expect(over(emptyLobby(), 'host', { t: 'over', result: {}, summary: [] })).toBeNull();
  });

  it('reconnects back off exponentially with jitter, capped at a few seconds', () => {
    expect(backoff(0, () => 0)).toBe(250);
    expect(backoff(0, () => 1)).toBe(650);
    expect(backoff(10, () => 1)).toBe(8250);
    expect(backoff(3, () => 0.5)).toBeGreaterThan(backoff(1, () => 0.5));
  });
});
