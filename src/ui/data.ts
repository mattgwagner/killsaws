// Roster + custom bots + lore lookups shared by the screens.
import { ROSTER } from '../sim/roster';
import { BotDesign, computeStats, kgToLb } from '../sim/design';
import loreJson from '../data/lore.json';

export interface Lore {
  id: string; name: string; team: string; captain: string | null; hometown: string; debut: string | null;
  weaponType: string; weapon: string; armor: string[]; giantNuts: string[]; runnerUp: string[];
  awards: string[]; records: string[]; fights: { opponent: string; season: string; summary: string; result: string }[];
  trivia: string; selfRighting: string | null; uncertain: string[]; sources: string[];
}
export const LORE = loreJson as Lore[];
export const loreFor = (id: string) => LORE.find((l) => l.id === id);

const KEY = 'killsaws.custom.v1';
// JSON has no Infinity: unlimited shots (flywheel, electric) travel as 'Infinity' in saves and share codes.
// Saves from before that held null, which would leave the flipper unable to fire.
export const infinityReplacer = (_k: string, v: unknown) => (v === Infinity ? 'Infinity' : v);
export const infinityReviver = (k: string, v: unknown) => (v === 'Infinity' || (k === 'shots' && v === null) ? Infinity : v);
export function loadCustom(): BotDesign[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]', infinityReviver); } catch { return []; }
}
export function saveCustom(list: BotDesign[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list, infinityReplacer)); } catch { /* private mode */ }
}
export function allBots(): BotDesign[] {
  return [...ROSTER, ...loadCustom()];
}
export const botById = (id: string) => allBots().find((b) => b.id === id);

export function shortStats(d: BotDesign) {
  const s = computeStats(d);
  return {
    lb: kgToLb(s.mass),
    mph: s.topSpeedMph,
    kj: s.weapon?.energyKJ,
    tip: s.weapon?.tipSpeedMph,
    rpm: s.weapon?.maxRpm,
    spin: s.weapon?.spinUpS,
    inv: s.invertible,
    legal: s.legal,
    stats: s,
  };
}

export const WEAPON_LABEL: Record<string, string> = {
  'horizontal-bar': 'Horizontal bar spinner', 'horizontal-disk': 'Horizontal disk', undercutter: 'Undercutter',
  'vertical-disk': 'Vertical disk spinner', 'vertical-bar': 'Vertical bar spinner', drum: 'Drum spinner', eggbeater: 'Eggbeater',
  shell: 'Full-body shell spinner', flipper: 'Flipper', lifter: 'Lifter', hammer: 'Overhead hammer', axe: 'Axe', 'saw-arm': 'Hammer-saw arm',
  crusher: 'Hydraulic crusher', none: 'No weapon',
};
export function weaponLabel(d: BotDesign) {
  const w = d.weapon;
  if (w.type === 'spinner') return WEAPON_LABEL[w.style];
  if (w.type === 'flipper') return `${w.actuator === 'pneumatic' ? 'Pneumatic' : w.actuator === 'hydraulic' ? 'Hydraulic' : w.actuator === 'flywheel' ? 'Flywheel' : 'Electric'} ${w.style}`;
  if (w.type === 'hammer') return WEAPON_LABEL[w.style];
  return WEAPON_LABEL[w.type];
}

export const BUILD = (import.meta.env.VITE_BUILD as string | undefined) ?? 'dev';
