import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ROSTER } from '../src/sim/roster';
import { chassisHull } from '../src/sim/bot';
import { blueprintGeometry } from '../src/render/blueprintMesh';

describe('blueprints', () => {
  const bps = ROSTER.filter((d) => d.chassis.blueprint);
  it('at least the first batch (Minotaur, Witch Doctor) uses a blueprint', () => {
    expect(bps.map((d) => d.id)).toEqual(expect.arrayContaining(['minotaur', 'witch-doctor']));
  });
  for (const d of bps) {
    it(`${d.name}: what you see is what collides (render bbox = collider bbox within 1 mm)`, () => {
      const g = blueprintGeometry(d.chassis.blueprint!).geometry;
      g.computeBoundingBox();
      const pts = chassisHull(d);
      const hull = new THREE.Box3();
      for (let i = 0; i < pts.length; i += 3) hull.expandByPoint(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
      for (const k of ['min', 'max'] as const) for (const ax of ['x', 'y', 'z'] as const) {
        expect(Math.abs(g.boundingBox![k][ax] - hull[k][ax]), `${k}.${ax}`).toBeLessThan(0.001);
      }
    });
    it(`${d.name}: chassis length/width match the blueprint bounding box`, () => {
      const pts = chassisHull(d);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < pts.length; i += 3) { minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]); minZ = Math.min(minZ, pts[i + 2]); maxZ = Math.max(maxZ, pts[i + 2]); }
      expect(Math.abs(maxX - minX - d.chassis.length)).toBeLessThan(0.001);
      expect(Math.abs(maxZ - minZ - d.chassis.width)).toBeLessThan(0.001);
    });
  }
});

import { armHead, frameOf } from '../src/sim/blueprint';
import { IN } from '../src/sim/parts';

describe('blueprint arms', () => {
  const armed = ROSTER.filter((d) => d.chassis.blueprint?.arm);
  it('the hammers and hammer saws all have a blueprint arm', () => {
    expect(armed.map((d) => d.id)).toEqual(expect.arrayContaining(['beta', 'blacksmith', 'sawblaze', 'skorpios']));
  });
  for (const d of armed) {
    const bp = d.chassis.blueprint!;
    const a = bp.arm!;
    const f = frameOf(bp);
    it(`${d.name}: the drawn arm matches the sim's reach within 4 in`, () => {
      expect(d.weapon.type).toBe('hammer');
      if (d.weapon.type === 'hammer') expect(Math.abs(a.length * IN - d.weapon.armLength)).toBeLessThan(4 * IN);
    });
    it(`${d.name}: at rest the head is up off the deck; at the strike it lands past the nose and above the floor`, () => {
      const rest = armHead(bp, a.rest), strike = armHead(bp, a.strike);
      expect(rest.y).toBeGreaterThan(f.hy);
      expect(strike.x).toBeGreaterThan(f.maxX - 1 * IN);
      const headHalf = ((a.head.kind === 'box' ? a.head.size[2] ?? a.head.size[1] : a.head.size[0]) * IN) / 2;
      expect(strike.y - headHalf).toBeGreaterThan(f.floorY - 1 * IN);
      expect(strike.y - headHalf).toBeLessThan(f.hy);
    });
  }
});
