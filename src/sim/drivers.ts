// Driver profiles: the game plan each real team runs, as data the BotAI
// executes. Difficulty (rookie / veteran / champion) is an overlay on top of
// these: reaction delay, aim noise and hazard sense, never a different plan.
//
// Tendencies are from the broadcasts (research/notes.md, src/data/lore.json).

import type { BotDesign } from './design';

/** How the robot closes on its opponent. */
export type Approach =
  /** face the opponent and charge, weapon first */
  | 'square-up'
  /** offset the final approach so the bar / disk meets the opponent's side or corner */
  | 'angle-off'
  /** hold distance and orbit, then commit for one hit */
  | 'circle'
  /** get the wedge / forks under from any angle and keep driving */
  | 'wedge-in'
  /** wait for the opponent to come into range */
  | 'stand-off';

/** What the plan turns into when the weapon is gone (or out of gas). */
export type Fallback = 'pusher' | 'wedge-pin';

export interface DriverProfile {
  approach: Approach;
  /** rad: angle-off offset, or the angle a circler commits from */
  angle: number;
  /** m between centres: inside this the robot commits (stand-off, circle) */
  engageRange: number;
  /** spinners: fraction of max rpm before the first committed approach */
  spinUp: number;
  /** spinners: back off to re-spin when rpm falls below this fraction after contact (0 = never) */
  respin: number;
  /** seconds backing off to re-spin */
  respinTime: number;
  /** spin up in a corner before the first approach (big shells and full-body spinners) */
  cornerSpinUp: boolean;
  /** throttle while driving through the opponent, 0..1 */
  pressure: number;
  /** keep chasing a robot that's down / airborne and hit it again */
  follow: boolean;
  /** work the opponent toward a wall: pin, or flip against it */
  wallPlay: boolean;
  /** 0..1: steer a carried, pinned or lifted opponent onto the screws, killsaws or Pulverizer */
  hazardPlay: number;
  /** ahead on the cards in the final minute: let the opponent come */
  standLate: boolean;
  /** can't afford to be flipped: never present the front or side to a flipper */
  flipperShy: boolean;
  /** drum / vertical: punch with the secondary (Tantrum's slide, Whiplash's lifter) only once the wedge is under */
  secondaryOnLift: boolean;
  fallback: Fallback;
}

const BASE: DriverProfile = {
  approach: 'square-up', angle: 0, engageRange: 2.2, spinUp: 0.7, respin: 0, respinTime: 1.4,
  cornerSpinUp: false, pressure: 0.9, follow: false, wallPlay: false, hazardPlay: 0.4,
  standLate: false, flipperShy: false, secondaryOnLift: false, fallback: 'pusher',
};

const p = (o: Partial<DriverProfile>): DriverProfile => ({ ...BASE, ...o });

/** Real tendencies, per roster id. */
export const DRIVERS: Record<string, DriverProfile> = {
  // squares up, charges with the bar, backs off to re-spin after every hit, lets them come late
  tombstone: p({ approach: 'square-up', spinUp: 0.75, respin: 0.5, respinTime: 1.6, standLate: true, pressure: 1, fallback: 'pusher' }),
  // wedge at the opponent's weapon, pin to the wall, never spins down
  'bite-force': p({ approach: 'wedge-in', spinUp: 0.6, pressure: 1, wallPlay: true, hazardPlay: 0.7, fallback: 'wedge-pin' }),
  // drum pressure: constant contact, drives through
  minotaur: p({ approach: 'square-up', spinUp: 0.6, pressure: 1, wallPlay: true, hazardPlay: 0.5 }),
  // wedgelets under, lift and carry into the hazards
  'witch-doctor': p({ approach: 'wedge-in', spinUp: 0.65, pressure: 0.95, hazardPlay: 0.9, wallPlay: true, fallback: 'wedge-pin' }),
  // under and flip, follow and flip again, flip against the wall
  hydra: p({ approach: 'wedge-in', pressure: 0.95, follow: true, wallPlay: true, hazardPlay: 0.5, fallback: 'wedge-pin' }),
  // big wheels, straight on, retreat to re-spin, never squares up on a wedge for long
  huge: p({ approach: 'square-up', spinUp: 0.85, respin: 0.55, respinTime: 1.8, standLate: true, pressure: 0.85, engageRange: 2.6 }),
  // fast chaser, angled approach so the disk meets a corner, pins and hits
  'end-game': p({ approach: 'angle-off', angle: 0.35, spinUp: 0.7, pressure: 1, wallPlay: true, hazardPlay: 0.5, fallback: 'wedge-pin' }),
  // wedge under, pin to the wall, drop the saw while pinned
  sawblaze: p({ approach: 'wedge-in', pressure: 1, wallPlay: true, hazardPlay: 0.8, fallback: 'wedge-pin' }),
  // wedge and lift; the disk matters once they're exposed
  whiplash: p({ approach: 'wedge-in', spinUp: 0.5, pressure: 0.95, wallPlay: true, secondaryOnLift: true, hazardPlay: 0.6, fallback: 'wedge-pin' }),
  // rams everywhere at full speed, spinner opportunistic
  hypershock: p({ approach: 'square-up', spinUp: 0.4, pressure: 1, hazardPlay: 0.5 }),
  // picks a disk, approaches at an angle
  rotator: p({ approach: 'angle-off', angle: 0.45, spinUp: 0.7, respin: 0.4, pressure: 0.85 }),
  copperhead: p({ approach: 'square-up', spinUp: 0.65, pressure: 1, wallPlay: true }),
  // wedge, lift, then spin
  'lock-jaw': p({ approach: 'wedge-in', spinUp: 0.6, pressure: 0.95, wallPlay: true, hazardPlay: 0.5 }),
  // slow, circles at range, one big hit at a time; can't self-right
  icewave: p({ approach: 'circle', angle: 0.6, engageRange: 3.2, spinUp: 0.9, respin: 0.6, respinTime: 2.2, pressure: 0.8, flipperShy: true, standLate: true }),
  // spin up in a corner, then drive at them; the shell hits on any approach
  gigabyte: p({ approach: 'square-up', cornerSpinUp: true, spinUp: 0.6, respin: 0.45, respinTime: 2, pressure: 0.85, flipperShy: true }),
  'son-of-whyachi': p({ approach: 'square-up', cornerSpinUp: true, spinUp: 0.85, respin: 0.45, respinTime: 2, pressure: 0.85, flipperShy: true }),
  // wedge under, then hammer the top deck
  beta: p({ approach: 'wedge-in', pressure: 0.9, hazardPlay: 0.5, wallPlay: true }),
  blacksmith: p({ approach: 'wedge-in', pressure: 0.9, hazardPlay: 0.5, wallPlay: true }),
  // flywheel flipper: fast, relentless, flips and flips again
  blip: p({ approach: 'wedge-in', pressure: 1, follow: true, wallPlay: true, hazardPlay: 0.6, fallback: 'wedge-pin' }),
  // under and flip toward the walls; aim the flip at the screws
  bronco: p({ approach: 'wedge-in', pressure: 0.9, follow: true, wallPlay: true, hazardPlay: 0.9, fallback: 'wedge-pin' }),
  // pure wedge, pushes into hazards, never stops moving
  duck: p({ approach: 'wedge-in', pressure: 1, follow: true, wallPlay: true, hazardPlay: 1, fallback: 'wedge-pin' }),
  // wedge under, then punch
  tantrum: p({ approach: 'wedge-in', spinUp: 0.6, pressure: 0.95, secondaryOnLift: true, hazardPlay: 0.5 }),
  // bite and hold, then drag to the killsaws
  quantum: p({ approach: 'wedge-in', pressure: 0.9, hazardPlay: 1, wallPlay: true }),
  // undercutters: low and angled, re-spin after hits
  valkyrie: p({ approach: 'angle-off', angle: 0.4, spinUp: 0.65, respin: 0.45, respinTime: 1.5, pressure: 0.9, flipperShy: true }),
  calypso: p({ approach: 'angle-off', angle: 0.4, spinUp: 0.65, respin: 0.45, respinTime: 1.5, pressure: 0.9 }),
  // vertical disk, in close, drives through
  cobalt: p({ approach: 'square-up', spinUp: 0.65, pressure: 1, wallPlay: true }),
  // saw arm on a wedge: get under, pin, drop the saw
  skorpios: p({ approach: 'wedge-in', pressure: 0.95, wallPlay: true, hazardPlay: 0.7, fallback: 'wedge-pin' }),
  // six-wheel vertical: drives through, pressure, re-righted by the disk
  madcatter: p({ approach: 'square-up', spinUp: 0.65, pressure: 1, wallPlay: true, hazardPlay: 0.5 }),
  // bar, square-up, re-spin
  bloodsport: p({ approach: 'square-up', spinUp: 0.8, respin: 0.45, respinTime: 1.5, pressure: 0.95 }),
};

/** A sensible plan for a robot nobody profiled (Garage builds, new roster entries), from its weapon. */
export function defaultProfile(d: BotDesign): DriverProfile {
  const w = d.weapon;
  const shy = d.chassis.selfRighter === undefined && d.chassis.invertibleOverride !== true;
  switch (w.type) {
    case 'spinner':
      if (w.style === 'shell') return p({ cornerSpinUp: true, spinUp: 0.85, respin: 0.45, respinTime: 2, pressure: 0.85 });
      if (w.style === 'horizontal-bar' || w.style === 'horizontal-disk') return p({ approach: 'angle-off', angle: 0.3, spinUp: 0.8, respin: 0.45, pressure: 0.9 });
      if (w.style === 'undercutter') return p({ approach: 'angle-off', angle: 0.4, spinUp: 0.8, respin: 0.45, pressure: 0.9 });
      return p({ approach: d.chassis.forks || d.chassis.wedgeLength > 0 ? 'wedge-in' : 'square-up', spinUp: 0.65, pressure: 1, wallPlay: true });
    case 'flipper':
      return p({ approach: 'wedge-in', pressure: 0.95, follow: true, wallPlay: true, hazardPlay: 0.7, fallback: 'wedge-pin' });
    case 'hammer':
      return p({ approach: 'wedge-in', pressure: 0.9, wallPlay: true, hazardPlay: 0.5, flipperShy: shy });
    case 'crusher':
      return p({ approach: 'wedge-in', pressure: 0.9, hazardPlay: 0.9 });
    default:
      return p({ approach: 'wedge-in', pressure: 1, wallPlay: true, hazardPlay: 0.8, fallback: 'wedge-pin' });
  }
}

export function driverFor(d: BotDesign): DriverProfile {
  return DRIVERS[d.id] ?? defaultProfile(d);
}

/** The clock and the cards. Behind with 30 s left means aggression; ahead in the last minute means control. */
export type ClockMode = 'plan' | 'aggress' | 'control';
export function clockMode(remaining: number, mine: number, theirs: number): ClockMode {
  if (remaining > 60) return 'plan';
  const margin = mine - theirs;
  if (remaining <= 30 && margin <= 0) return 'aggress';
  if (margin > 1) return 'control';
  return 'plan';
}
