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
