// Keyboard and gamepad drivers. Keyboard inputs are slew-limited so a
// digital key behaves like a transmitter stick being pushed, not a switch.
import { BotInput } from './sim/bot';

export type ControllerKind = 'kb1' | 'kb2' | 'pad0' | 'pad1' | 'ai' | 'net';

const keys = new Set<string>();
let bound = false;
export function bindKeys() {
  if (bound) return;
  bound = true;
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
}
export const keyDown = (code: string) => keys.has(code);

export const KEYMAPS = {
  kb1: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', weapon: 'Space', alt: 'KeyE', flame: 'KeyQ', hazard: 'KeyR' },
  kb2: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', weapon: 'Slash', alt: 'Period', flame: 'Comma', hazard: 'KeyM' },
} as const;

export const KEY_LABELS = {
  kb1: { drive: 'W A S D', weapon: 'Space', alt: 'E', flame: 'Q', hazard: 'R' },
  kb2: { drive: 'Arrow keys', weapon: '/', alt: '.', flame: ',', hazard: 'M' },
  pad: { drive: 'Left stick', weapon: 'RT / A', alt: 'LT / X', flame: 'B', hazard: 'Y' },
};

export class HumanDriver {
  private t = 0;
  private u = 0;
  constructor(readonly kind: ControllerKind) {}

  read(dt: number): BotInput {
    if (this.kind === 'pad0' || this.kind === 'pad1') return this.readPad(this.kind === 'pad0' ? 0 : 1);
    const k = KEYMAPS[this.kind === 'kb2' ? 'kb2' : 'kb1'];
    const tt = (keyDown(k.up) ? 1 : 0) - (keyDown(k.down) ? 1 : 0);
    const uu = (keyDown(k.right) ? 1 : 0) - (keyDown(k.left) ? 1 : 0);
    // stick-like ramping; turning eases off at full throttle so it can be driven straight
    const rate = 5;
    this.t += Math.sign(tt - this.t) * Math.min(Math.abs(tt - this.t), rate * dt * (tt === 0 ? 2.5 : 1));
    this.u += Math.sign(uu - this.u) * Math.min(Math.abs(uu - this.u), rate * 1.6 * dt * (uu === 0 ? 2.5 : 1));
    const turn = this.u * (1 - 0.45 * Math.abs(this.t));
    return {
      throttle: this.t, turn, weapon: keyDown(k.weapon), alt: keyDown(k.alt), flame: keyDown(k.flame), hazard: keyDown(k.hazard),
    };
  }

  private readPad(i: number): BotInput {
    const pads = navigator.getGamepads?.() ?? [];
    const p = [...pads].filter(Boolean)[i];
    if (!p) return { throttle: 0, turn: 0, weapon: false };
    const dz = (x: number) => (Math.abs(x) < 0.12 ? 0 : (x - Math.sign(x) * 0.12) / 0.88);
    const ly = dz(p.axes[1] ?? 0);
    const lx = dz(p.axes[0] ?? 0);
    const rt = p.buttons[7]?.value ?? 0;
    const lt = p.buttons[6]?.value ?? 0;
    // expo curve, like a real radio
    const expo = (x: number) => Math.sign(x) * (0.35 * Math.abs(x) + 0.65 * x * x);
    return {
      throttle: -expo(ly), turn: expo(lx) * 0.85,
      weapon: rt > 0.5 || !!p.buttons[0]?.pressed,
      alt: lt > 0.5 || !!p.buttons[2]?.pressed,
      flame: !!p.buttons[1]?.pressed,
      hazard: !!p.buttons[3]?.pressed,
    };
  }
}

export function padCount() {
  return [...(navigator.getGamepads?.() ?? [])].filter(Boolean).length;
}
