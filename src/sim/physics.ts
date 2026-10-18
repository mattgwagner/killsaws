import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<void> | null = null;
export function initPhysics() {
  if (!ready) ready = RAPIER.init();
  return ready;
}
export { RAPIER };

// Collision groups: membership in the high 16 bits, filter in the low 16.
export const G = {
  FLOOR: 1,
  WALL: 2,
  CHASSIS: 4,
  WHEEL: 8,
  WEAPON: 16,
  DEBRIS: 32,
  HAZARD: 64,
} as const;

export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

export const COLLIDE = {
  floor: groups(G.FLOOR, G.CHASSIS | G.DEBRIS | G.WEAPON),
  wall: groups(G.WALL, G.CHASSIS | G.WHEEL | G.WEAPON | G.DEBRIS),
  chassis: groups(G.CHASSIS, G.FLOOR | G.WALL | G.CHASSIS | G.WHEEL | G.WEAPON | G.HAZARD),
  wheel: groups(G.WHEEL, G.WALL | G.CHASSIS | G.WEAPON | G.WHEEL | G.HAZARD),
  weapon: groups(G.WEAPON, G.FLOOR | G.WALL | G.CHASSIS | G.WHEEL | G.WEAPON | G.HAZARD),
  // debris can't hold a robot up (robots drive over plates), so it skips chassis and wheels
  debris: groups(G.DEBRIS, G.FLOOR | G.WALL | G.DEBRIS | G.HAZARD),
  hazard: groups(G.HAZARD, G.CHASSIS | G.WHEEL | G.WEAPON | G.DEBRIS),
  /** what a wheel ray can stand on */
  wheelRay: groups(0xffff, G.FLOOR | G.CHASSIS | G.HAZARD),
  /** what a weapon sweep can strike */
  weaponQuery: groups(0xffff, G.CHASSIS | G.WHEEL | G.WEAPON | G.WALL | G.HAZARD),
};
