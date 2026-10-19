// The Garage: build a 250 lb robot from real parts. Every number on the
// right is derived from the parts on the left by the same model the fights use.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BotDesign, SpinnerStyle, Weapon, accelCurve, computeStats, fitToWeight, kgToLb, runtimeMinutes, spinUpCurve, WEIGHT_LIMIT,
} from '../sim/design';
import { IN, LB, MATERIALS, MOTORS, MaterialId, MotorId, TIRES, TireId, batteryMaxCurrent } from '../sim/parts';
import { ROSTER } from '../sim/roster';
import { buildBot, poseBot } from '../render/botmesh';
import { infinityReplacer, infinityReviver, loadCustom, saveCustom, weaponLabel } from './data';

const clone = (d: BotDesign): BotDesign => structuredClone(d);

const BLANK: BotDesign = (() => {
  const d = clone(ROSTER.find((b) => b.id === 'witch-doctor')!);
  return { ...d, id: 'custom-new', name: 'My Bot', team: 'Garage Built', look: { ...d.look, logo: 'MY BOT', primary: '#c43a1f', secondary: '#202225', accent: '#f2c400', features: [] }, flame: false };
})();

const SPIN_STYLES: SpinnerStyle[] = ['horizontal-bar', 'horizontal-disk', 'undercutter', 'vertical-disk', 'vertical-bar', 'drum', 'eggbeater', 'shell'];

function defaultWeapon(kind: string, d: BotDesign): Weapon {
  const H = d.chassis.height, L = d.chassis.length;
  if (SPIN_STYLES.includes(kind as SpinnerStyle)) {
    const style = kind as SpinnerStyle;
    const vertical = ['vertical-disk', 'vertical-bar', 'drum', 'eggbeater'].includes(style);
    const radius = style === 'drum' ? 0.12 : style === 'shell' ? L / 2 + 0.02 : style.startsWith('horizontal') ? 0.45 : style === 'undercutter' ? 0.38 : 0.22;
    return {
      type: 'spinner', style, rotorMass: style === 'shell' ? 50 : 20, radius, width: style === 'drum' ? 0.4 : style === 'shell' ? H * 0.9 : 0.04,
      teeth: 2, toothHeight: 0.025, material: 's7', motor: 'bl80100-130', motorCount: 1, ratio: 2,
      mountX: style === 'shell' ? 0 : vertical ? L / 2 - 0.02 : style === 'undercutter' ? L / 2 + 0.05 : L / 2 + 0.15,
      mountY: vertical ? Math.max(0, radius + 0.01 - (d.chassis.clearance + H / 2)) : style === 'undercutter' ? -H / 2 + 0.02 : style === 'shell' ? 0 : H / 2 + 0.06,
    };
  }
  if (kind === 'flipper' || kind === 'lifter') return { type: 'flipper', style: kind, actuator: kind === 'flipper' ? 'pneumatic' : 'electric', energy: kind === 'flipper' ? 8000 : 4000, plateLength: 0.6, plateWidth: 0.6, shots: kind === 'flipper' ? 20 : Infinity, cooldown: kind === 'flipper' ? 1.2 : 0.7, systemMass: kind === 'flipper' ? 26 : 15 };
  if (kind === 'hammer' || kind === 'axe' || kind === 'saw-arm') return { type: 'hammer', style: kind, headMass: 6, armLength: 0.75, energy: kind === 'saw-arm' ? 900 : 4000, swingTime: 0.3, cooldown: 0.8, systemMass: 18, sawRpm: kind === 'saw-arm' ? 5000 : undefined };
  if (kind === 'crusher') return { type: 'crusher', force: 120000, reach: 0.4, cycleTime: 0.5, systemMass: 28 };
  return { type: 'none' };
}

/** Flipper power sources: what each one weighs and what it costs you in the fight. */
const FLIPPER_ACTUATORS: Record<'pneumatic' | 'hydraulic' | 'flywheel', { label: string; shots: number; cooldown: number; systemMass: number; cost: string }> = {
  pneumatic: { label: 'Pneumatic (CO₂)', shots: 20, cooldown: 1.2, systemMass: 26, cost: 'Every shot spends gas: when the tank is empty the flipper is dead weight.' },
  hydraulic: { label: 'Hydraulic (Hydra)', shots: Infinity, cooldown: 3.6, systemMass: 26, cost: 'A pump never runs out, but the ram is slow to reset between fires.' },
  flywheel: { label: 'Flywheel + clutch (Blip)', shots: Infinity, cooldown: 1.5, systemMass: 30, cost: 'Never runs out: a motor re-spins a flywheel and a clutch dumps it into the plate. Heavier, draws from the battery, and a shot fired before the wheel is back up to speed is weaker. A hurt weapon motor re-spins slower.' },
};

export function Garage({ onBack, onTest }: { onBack: () => void; onTest: (d: BotDesign) => void }) {
  const [saved, setSaved] = useState<BotDesign[]>(loadCustom);
  const [d, setD] = useState<BotDesign>(() => saved[0] ? clone(saved[0]) : clone(BLANK));
  const [toast, setToast] = useState('');
  const stats = useMemo(() => computeStats(d), [d]);
  const up = (f: (x: BotDesign) => void) => setD((prev) => { const n = clone(prev); f(n); return n; });
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2400); };

  const save = () => {
    const id = d.id.startsWith('custom-') && d.id !== 'custom-new' ? d.id : `custom-${Date.now().toString(36)}`;
    const nd = { ...d, id };
    const list = [nd, ...saved.filter((b) => b.id !== id)];
    saveCustom(list); setSaved(list); setD(nd);
    flash(stats.legal ? `Saved. ${nd.name} is in the Exhibition roster.` : `Saved, but ${nd.name} is over 250 lb and won't pass tech inspection.`);
  };
  const exportCode = async () => {
    const code = 'KS1:' + btoa(unescape(encodeURIComponent(JSON.stringify(d, infinityReplacer))));
    try { await navigator.clipboard.writeText(code); flash('Bot code copied. Paste it in Discord.'); } catch { prompt('Copy this bot code:', code); }
  };
  const importCode = () => {
    const code = prompt('Paste a KILLSAWS bot code (starts with KS1:)');
    if (!code?.startsWith('KS1:')) return;
    try {
      const nd = JSON.parse(decodeURIComponent(escape(atob(code.slice(4)))), infinityReviver) as BotDesign;
      nd.id = `custom-${Date.now().toString(36)}`;
      setD(nd); flash(`Imported ${nd.name}. Save it to fight with it.`);
    } catch { flash("That code didn't decode."); }
  };

  const w = d.weapon;
  const sp = w.type === 'spinner' ? w : null;
  const ampsOver = stats.weapon && stats.weapon.peakAmps > batteryMaxCurrent(d.battery);
  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn small" onClick={onBack}>← Back</button>
        <h2>Garage</h2>
        <span className="spacer" />
        <select value="" onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          const src = [...ROSTER, ...saved].find((b) => b.id === v)!;
          const n = clone(src);
          if (!v.startsWith('custom-')) { n.id = 'custom-new'; n.name = `${src.name} (copy)`; }
          setD(n);
        }}>
          <option value="">Load / start from…</option>
          <optgroup label="Your bots">{saved.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
          <optgroup label="Start from a pro bot">{ROSTER.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
        </select>
        <button className="btn small" onClick={() => setD(clone(BLANK))}>New</button>
        <button className="btn small" onClick={importCode}>Import code</button>
        <button className="btn small" onClick={exportCode}>Share code</button>
        <button className="btn small" onClick={save}>Save</button>
        <button className="btn small primary" onClick={() => { save(); onTest(d); }}>Test fight</button>
      </div>
      <div className="garage">
        <div className="col">
          <h4>Identity</h4>
          <Text label="Name" value={d.name} on={(v) => up((x) => { x.name = v; x.look.logo = v.toUpperCase(); })} />
          <Text label="Team" value={d.team} on={(v) => up((x) => { x.team = v; })} />
          <div className="field"><span>Paint</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <input type="color" value={d.look.primary} onChange={(e) => up((x) => { x.look.primary = e.target.value; })} />
              <input type="color" value={d.look.secondary} onChange={(e) => up((x) => { x.look.secondary = e.target.value; })} />
              <input type="color" value={d.look.accent} onChange={(e) => up((x) => { x.look.accent = e.target.value; })} />
            </span>
            <Pick value={d.look.pattern ?? 'solid'} options={['solid', 'stripes', 'flames', 'checker', 'split', 'tiger', 'rivets', 'carbon']} on={(v) => up((x) => { x.look.pattern = v as BotDesign['look']['pattern']; })} />
          </div>

          <h4>Chassis</h4>
          <div className="field"><span>Shape</span><Pick value={d.chassis.shape} options={['box', 'wedge', 'double-wedge', 'low-flat', 'tall', 'ring']} on={(v) => up((x) => { x.chassis.shape = v as BotDesign['chassis']['shape']; if (v === 'box' || v === 'low-flat' || v === 'ring') x.chassis.wedgeLength = 0; else if (!x.chassis.wedgeLength) x.chassis.wedgeLength = 0.15; })} /><span /></div>
          <Num label="Length" unit="in" value={d.chassis.length / IN} min={14} max={48} step={0.5} on={(v) => up((x) => { x.chassis.length = v * IN; })} />
          <Num label="Width" unit="in" value={d.chassis.width / IN} min={14} max={48} step={0.5} on={(v) => up((x) => { x.chassis.width = v * IN; x.drive.track = Math.min(x.drive.track, v * IN); })} />
          <Num label="Height" unit="in" value={d.chassis.height / IN} min={3} max={16} step={0.25} on={(v) => up((x) => { x.chassis.height = v * IN; })} />
          <Num label="Ground clearance" unit="in" value={d.chassis.clearance / IN} min={0.2} max={20} step={0.1} on={(v) => up((x) => { x.chassis.clearance = v * IN; })} />
          {d.chassis.wedgeLength > 0 && <Num label="Wedge length" unit="in" value={d.chassis.wedgeLength / IN} min={2} max={16} step={0.5} on={(v) => up((x) => { x.chassis.wedgeLength = v * IN; })} />}
          <Num label="Nose width" unit="%" value={(d.chassis.noseTaper ?? 1) * 100} min={25} max={100} step={5} on={(v) => up((x) => { x.chassis.noseTaper = v / 100; })} />
          <Check label="Hinged forks / wedgelets" value={!!d.chassis.forks} on={(v) => up((x) => { x.chassis.forks = v; })} />
          {d.drive.wheels === 2 && (
            <Check label="Stabilizing legs (axle-centre two-wheelers like HUGE)" value={!!d.chassis.stabilizers} on={(v) => up((x) => {
              x.chassis.stabilizers = v ? { span: Math.max(0.15, x.drive.wheelDiameter * 0.4), strut: 0.038, offsetZ: x.chassis.width * 0.2 } : undefined;
            })} />
          )}
          <div className="field"><span>Self-righter</span><Pick value={d.chassis.selfRighter ?? 'none'} options={['none', 'arm', 'pole', 'torque']} on={(v) => up((x) => { x.chassis.selfRighter = v === 'none' ? undefined : v as 'arm'; })} /><span /></div>
          <div className="field"><span>Frame</span><Mat value={d.chassis.frame} on={(v) => up((x) => { x.chassis.frame = v; })} /><Thick v={d.chassis.frameThickness} on={(v) => up((x) => { x.chassis.frameThickness = v; })} /></div>

          <h4>Armor</h4>
          {(['front', 'sides', 'rear', 'top', 'bottom'] as const).map((f) => (
            <div className="field" key={f}><span style={{ textTransform: 'capitalize' }}>{f}</span>
              <Mat value={d.chassis.armor[f].material} on={(v) => up((x) => { x.chassis.armor[f].material = v; })} />
              <Thick v={d.chassis.armor[f].thickness} on={(v) => up((x) => { x.chassis.armor[f].thickness = v; })} />
            </div>
          ))}
          <p className="flag">{MATERIALS[d.chassis.armor.front.material].blurb}</p>

          <h4>Drivetrain</h4>
          <div className="field"><span>Wheels</span><Pick value={String(d.drive.wheels)} options={['2', '4', '6']} on={(v) => up((x) => { x.drive.wheels = Number(v) as 2; if (x.drive.wheels > 2 && !x.drive.wheelbase) x.drive.wheelbase = x.chassis.length * 0.55; })} /><span /></div>
          <Num label="Wheel diameter" unit="in" value={d.drive.wheelDiameter / IN} min={3} max={40} step={0.5} on={(v) => up((x) => { x.drive.wheelDiameter = v * IN; })} />
          <Num label="Wheel width" unit="in" value={d.drive.wheelWidth / IN} min={1} max={6} step={0.25} on={(v) => up((x) => { x.drive.wheelWidth = v * IN; })} />
          <div className="field"><span>Tires</span><Pick value={d.drive.tire} options={Object.keys(TIRES)} labels={Object.values(TIRES).map((t) => `${t.name} (μ ${t.mu})`)} on={(v) => up((x) => { x.drive.tire = v as TireId; })} /><span /></div>
          <div className="field"><span>Drive motor</span><Pick value={d.drive.motor} options={Object.values(MOTORS).filter((m) => m.use !== 'weapon').map((m) => m.id)} labels={Object.values(MOTORS).filter((m) => m.use !== 'weapon').map((m) => m.name)} on={(v) => up((x) => { x.drive.motor = v as MotorId; })} /><span /></div>
          <Num label="Motors per side" value={d.drive.motorsPerSide} min={1} max={3} step={1} on={(v) => up((x) => { x.drive.motorsPerSide = v; })} />
          <Num label="Gear reduction" unit=":1" value={d.drive.ratio} min={2} max={60} step={0.5} on={(v) => up((x) => { x.drive.ratio = v; })} />
          {d.drive.wheels > 2 && <Num label="Wheelbase" unit="in" value={d.drive.wheelbase / IN} min={4} max={44} step={0.5} on={(v) => up((x) => { x.drive.wheelbase = v * IN; })} />}
          <Num label="Track width" unit="in" value={d.drive.track / IN} min={8} max={44} step={0.5} on={(v) => up((x) => { x.drive.track = v * IN; })} />
          <Num label="Axle offset" unit="in" value={(d.drive.axleX ?? 0) / IN} min={-18} max={18} step={0.5} on={(v) => up((x) => { x.drive.axleX = v * IN; })} />

          <h4>Battery (LiPo)</h4>
          <Num label="Cells in series" unit="S" value={d.battery.cellsS} min={4} max={14} step={1} on={(v) => up((x) => { x.battery.cellsS = v; })} />
          <Num label="Capacity per pack" unit="Ah" value={d.battery.capacityAh} min={1} max={12} step={0.5} on={(v) => up((x) => { x.battery.capacityAh = v; })} />
          <Num label="Packs in parallel" value={d.battery.packs} min={1} max={4} step={1} on={(v) => up((x) => { x.battery.packs = v; })} />
          <Num label="C rating" unit="C" value={d.battery.cRating} min={20} max={120} step={5} on={(v) => up((x) => { x.battery.cRating = v; })} />

          <h4>Weapon</h4>
          <div className="field"><span>Type</span>
            <Pick value={w.type === 'spinner' ? w.style : w.type === 'flipper' ? w.style : w.type === 'hammer' ? w.style : w.type}
              options={[...SPIN_STYLES, 'flipper', 'lifter', 'hammer', 'axe', 'saw-arm', 'crusher', 'none']}
              on={(v) => up((x) => { x.weapon = defaultWeapon(v, x); })} /><span /></div>
          {sp && (
            <>
              <Num label="Rotor mass" unit="lb" value={sp.rotorMass / LB} min={5} max={130} step={1} on={(v) => up((x) => { (x.weapon as typeof sp).rotorMass = v * LB; })} />
              <Num label="Rotor diameter" unit="in" value={(sp.radius * 2) / IN} min={4} max={64} step={0.5} on={(v) => up((x) => { (x.weapon as typeof sp).radius = (v * IN) / 2; })} />
              <Num label={sp.style === 'drum' ? 'Drum length' : 'Thickness'} unit="in" value={sp.width / IN} min={0.5} max={30} step={0.25} on={(v) => up((x) => { (x.weapon as typeof sp).width = v * IN; })} />
              <Num label="Teeth" value={sp.teeth} min={1} max={6} step={1} on={(v) => up((x) => { (x.weapon as typeof sp).teeth = v; })} />
              <Num label="Tooth height" unit="in" value={sp.toothHeight / IN} min={0.25} max={3} step={0.05} on={(v) => up((x) => { (x.weapon as typeof sp).toothHeight = v * IN; })} />
              <div className="field"><span>Rotor steel</span><Mat value={sp.material} on={(v) => up((x) => { (x.weapon as typeof sp).material = v; })} /><span /></div>
              <div className="field"><span>Weapon motor</span><Pick value={sp.motor} options={Object.values(MOTORS).filter((m) => m.use !== 'drive').map((m) => m.id)} labels={Object.values(MOTORS).filter((m) => m.use !== 'drive').map((m) => m.name)} on={(v) => up((x) => { (x.weapon as typeof sp).motor = v as MotorId; })} /><span /></div>
              <Num label="Motor count" value={sp.motorCount} min={1} max={3} step={1} on={(v) => up((x) => { (x.weapon as typeof sp).motorCount = v; })} />
              <Num label="Belt ratio" unit=":1" value={sp.ratio} min={0.3} max={8} step={0.05} on={(v) => up((x) => { (x.weapon as typeof sp).ratio = v; })} />
              <Num label="Mount forward" unit="in" value={sp.mountX / IN} min={-10} max={40} step={0.5} on={(v) => up((x) => { (x.weapon as typeof sp).mountX = v * IN; })} />
              <Num label="Mount height" unit="in" value={sp.mountY / IN} min={-8} max={16} step={0.25} on={(v) => up((x) => { (x.weapon as typeof sp).mountY = v * IN; })} />
            </>
          )}
          {w.type === 'flipper' && (
            <>
              <Num label="Energy per shot" unit="kJ" value={w.energy / 1000} min={0.5} max={14} step={0.25} on={(v) => up((x) => { (x.weapon as typeof w).energy = v * 1000; })} />
              <Num label="Plate length" unit="in" value={w.plateLength / IN} min={8} max={40} step={0.5} on={(v) => up((x) => { (x.weapon as typeof w).plateLength = v * IN; })} />
              {w.style === 'flipper' && (
                <div className="field"><span>Actuator</span>
                  <Pick value={w.actuator} options={Object.keys(FLIPPER_ACTUATORS)}
                    labels={Object.values(FLIPPER_ACTUATORS).map((a) => `${a.label} · ${(a.systemMass / LB).toFixed(0)} lb`)}
                    on={(v) => up((x) => { const a = FLIPPER_ACTUATORS[v as keyof typeof FLIPPER_ACTUATORS]; Object.assign(x.weapon, { actuator: v, shots: a.shots, cooldown: a.cooldown, systemMass: a.systemMass }); })} /><span /></div>
              )}
              {w.actuator === 'pneumatic' && <Num label="Gas (shots)" value={w.shots} min={4} max={40} step={1} on={(v) => up((x) => { (x.weapon as typeof w).shots = v; })} />}
              {w.actuator === 'flywheel' && <Num label="Flywheel re-spin" unit="s" value={w.cooldown} min={1} max={2} step={0.1} on={(v) => up((x) => { (x.weapon as typeof w).cooldown = v; })} />}
              <Num label="System mass" unit="lb" value={w.systemMass / LB} min={10} max={100} step={1} on={(v) => up((x) => { (x.weapon as typeof w).systemMass = v * LB; })} />
              {w.actuator in FLIPPER_ACTUATORS && <p className="flag">{FLIPPER_ACTUATORS[w.actuator as keyof typeof FLIPPER_ACTUATORS].cost}</p>}
            </>
          )}
          {w.type === 'hammer' && (
            <>
              <Num label="Head mass" unit="lb" value={w.headMass / LB} min={3} max={40} step={0.5} on={(v) => up((x) => { (x.weapon as typeof w).headMass = v * LB; })} />
              <Num label="Arm length" unit="in" value={w.armLength / IN} min={12} max={44} step={0.5} on={(v) => up((x) => { (x.weapon as typeof w).armLength = v * IN; })} />
              <Num label="Energy per swing" unit="kJ" value={w.energy / 1000} min={0.3} max={10} step={0.1} on={(v) => up((x) => { (x.weapon as typeof w).energy = v * 1000; })} />
            </>
          )}
          {w.type === 'crusher' && <Num label="Tip force" unit="klbf" value={w.force / 4448} min={5} max={50} step={1} on={(v) => up((x) => { (x.weapon as typeof w).force = v * 4448; })} />}
          <Check label="Flamethrower (cosmetic)" value={!!d.flame} on={(v) => up((x) => { x.flame = v; })} />
        </div>

        <div className="col">
          <Preview d={d} />
          <div className="weigh">
            <div className="flag">TECH INSPECTION · WEIGH-IN</div>
            <div className={`scale ${stats.legal ? 'ok' : 'over'}`}>{kgToLb(stats.mass).toFixed(1)} lb <span style={{ fontSize: 16 }}>/ 250.0</span></div>
            <MassBar items={stats.massItems} />
            <div className="legend">
              {stats.massItems.map((i) => (<Fragment key={i.label}><span>{i.label}</span><span>{kgToLb(i.kg).toFixed(1)} lb</span></Fragment>))}
            </div>
            <div className="row-btns">
              <button className="btn small" onClick={() => setD(fitToWeight(d))}>Fill armor to 250 lb</button>
            </div>
          </div>
        </div>

        <div className="col">
          <h4>Performance</h4>
          <div className="stats">
            <Stat v={`${stats.topSpeedMph.toFixed(1)} mph`} k="top speed" />
            <Stat v={`${(stats.pushForceN / 4.448).toFixed(0)} lbf`} k="pushing force" />
            <Stat v={`${stats.accel0to10ft.toFixed(2)} s`} k="0 to 10 ft" />
            <Stat v={stats.invertible ? 'YES' : 'NO'} k="drives inverted" />
            <Stat v={`${stats.batteryWh.toFixed(0)} Wh`} k="battery" />
            <Stat v={`${runtimeMinutes(d).toFixed(1)} min`} k="est. fight time" />
          </div>
          {stats.weapon && (
            <div className="stats">
              <Stat v={Math.round(stats.weapon.maxRpm).toLocaleString()} k="weapon rpm" />
              <Stat v={`${stats.weapon.tipSpeedMph.toFixed(0)} mph`} k="tip speed" />
              <Stat v={`${stats.weapon.energyKJ.toFixed(1)} kJ`} k="stored energy" />
              <Stat v={`${stats.weapon.spinUpS.toFixed(1)} s`} k="spin-up (90%)" />
              <Stat v={`${Math.round(stats.weapon.peakAmps)} A`} k="peak weapon draw" />
              <Stat v={`${(stats.weapon.inertia).toFixed(2)}`} k="inertia kg·m²" />
            </div>
          )}
          {stats.weapon && stats.weapon.tipSpeedMph > 250 && <p style={{ color: 'var(--orange)' }}>⚠ Tip speed is over the 250 mph limit BattleBots set in 2018. Gear it down.</p>}
          {ampsOver && <p style={{ color: 'var(--orange)' }}>⚠ Weapon draws more than the pack's {batteryMaxCurrent(d.battery).toFixed(0)} A rating. Expect voltage sag and a hot pack. Add a parallel pack or higher C.</p>}
          {!stats.legal && <p style={{ color: 'var(--red)' }}>✖ Over 250.0 lb. It won't pass the weigh-in.</p>}
          {d.weapon.type === 'none' && <p style={{ color: 'var(--orange)' }}>⚠ BattleBots requires at least one independently powered weapon.</p>}
          {!stats.invertible && !d.chassis.selfRighter && d.weapon.type !== 'flipper' && d.weapon.type !== 'hammer' && <p style={{ color: 'var(--orange)' }}>⚠ Not invertible and no self-righter: one flip and you're counted out.</p>}
          <h4>Drive: speed from a standstill</h4>
          <Chart pts={accelCurve(d).map((p) => [p.t, p.mph])} xLabel="s" yLabel="mph" color="#3ee06b" />
          {sp && (
            <>
              <h4>Weapon spin-up</h4>
              <Chart pts={spinUpCurve(sp, stats.nominalV, stats.batteryR).map((p) => [p.t, p.rpm])} xLabel="s" yLabel="rpm" color="#f2c400" />
            </>
          )}
          <p className="flag">{weaponLabel(d)}. Motor model: V = I·R + ω/Kv, torque = Kt·I, current-limited by the ESC; pack sag from LiPo internal resistance. Tire force from the friction coefficient against the steel floor.</p>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Stat({ v, k }: { v: string; k: string }) { return <div className="stat"><b>{v}</b><span>{k}</span></div>; }
function Text({ label, value, on }: { label: string; value: string; on: (v: string) => void }) {
  return <div className="field"><span>{label}</span><input type="text" value={value} maxLength={20} onChange={(e) => on(e.target.value)} /><span /></div>;
}
function Num({ label, value, min, max, step, unit, on }: { label: string; value: number; min: number; max: number; step: number; unit?: string; on: (v: number) => void }) {
  return (
    <div className="field">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => on(Number(e.target.value))} />
      <span className="val">{Number.isFinite(value) ? (step >= 1 ? value.toFixed(0) : value.toFixed(step >= 0.1 ? 1 : 2)) : '∞'}{unit ? ` ${unit}` : ''}</span>
    </div>
  );
}
function Check({ label, value, on }: { label: string; value: boolean; on: (v: boolean) => void }) {
  return <div className="field"><span>{label}</span><input type="checkbox" checked={value} onChange={(e) => on(e.target.checked)} /><span /></div>;
}
function Pick({ value, options, labels, on }: { value: string; options: string[]; labels?: string[]; on: (v: string) => void }) {
  return <select value={value} onChange={(e) => on(e.target.value)}>{options.map((o, i) => <option key={o} value={o}>{labels?.[i] ?? o}</option>)}</select>;
}
function Mat({ value, on }: { value: MaterialId; on: (v: MaterialId) => void }) {
  return <select value={value} onChange={(e) => on(e.target.value as MaterialId)}>{Object.values(MATERIALS).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>;
}
function Thick({ v, on }: { v: number; on: (v: number) => void }) {
  return <input type="number" min={1} max={120} step={0.5} value={v} onChange={(e) => on(Math.max(1, Number(e.target.value)))} title="thickness, mm" />;
}

const MASS_COLORS = ['#e5232f', '#ff7a1a', '#f2c400', '#c9e34a', '#3ee06b', '#2bc4b5', '#2a7bf0', '#7a5cff', '#c45cff', '#ff5cab', '#9aa1ab', '#e0e0e0', '#8a6a4a', '#5a7a8a'];
function MassBar({ items }: { items: { label: string; kg: number }[] }) {
  const total = Math.max(WEIGHT_LIMIT, items.reduce((s, i) => s + i.kg, 0));
  return (
    <div className="massbar" title="weight budget">
      {items.map((i, k) => <i key={i.label} title={`${i.label}: ${kgToLb(i.kg).toFixed(1)} lb`} style={{ width: `${(i.kg / total) * 100}%`, background: MASS_COLORS[k % MASS_COLORS.length] }} />)}
    </div>
  );
}

function Chart({ pts, xLabel, yLabel, color }: { pts: [number, number][]; xLabel: string; yLabel: string; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    const W = c.clientWidth, H = c.clientHeight, pad = 30;
    g.clearRect(0, 0, W, H);
    const xm = Math.max(...pts.map((p) => p[0])), ym = Math.max(1, ...pts.map((p) => p[1])) * 1.1;
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.fillStyle = '#9aa1ab';
    g.font = '10px JetBrains Mono, monospace';
    for (let i = 0; i <= 4; i++) {
      const y = H - pad + 6 - ((H - pad) * i) / 4 * 0.9;
      g.beginPath(); g.moveTo(pad, y); g.lineTo(W - 4, y); g.stroke();
      g.fillText(((ym * i) / 4).toFixed(ym > 100 ? 0 : 1), 2, y + 3);
    }
    g.fillText(`${xm.toFixed(0)} ${xLabel}`, W - 40, H - 4);
    g.fillText(yLabel, pad + 4, 12);
    g.strokeStyle = color; g.lineWidth = 2;
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const px = pad + (x / xm) * (W - pad - 6);
      const py = H - pad + 6 - (y / ym) * (H - pad) * 0.9;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    });
    g.stroke();
  }, [pts, color, xLabel, yLabel]);
  return <canvas ref={ref} className="chart" />;
}

/** Spinning 3D preview of the design on a turntable. */
function Preview({ d }: { d: BotDesign }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef<{ r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; bot?: THREE.Object3D; raf: number; angle: number } | null>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.9;
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight('#cfe0ff', '#221a12', 0.8));
    const key = new THREE.DirectionalLight('#fff', 2.2); key.position.set(2, 4, 3); scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.6, roughness: 0.5 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const cam = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
    cam.position.set(1.9, 1.2, 1.9); cam.lookAt(0, 0.15, 0);
    const st = { r, scene, cam, raf: 0, angle: 0 } as NonNullable<typeof state.current>;
    state.current = st;
    const loop = () => {
      st.raf = requestAnimationFrame(loop);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * r.getPixelRatio())) { r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
      st.angle += 0.006;
      if (st.bot) st.bot.rotation.y = st.angle;
      r.render(scene, cam);
    };
    loop();
    return () => { cancelAnimationFrame(st.raf); r.dispose(); };
  }, []);
  useEffect(() => {
    const st = state.current;
    if (!st) return;
    if (st.bot) st.scene.remove(st.bot);
    const m = buildBot(d);
    const s = computeStats(d);
    m.root.position.y = d.chassis.clearance + d.chassis.height / 2;
    poseBot(m, d, { weaponAngle: 0.4, actuator: 0, saw: 0, wheels: m.wheels.map(() => ({ angle: 0, attached: true })) });
    const holder = new THREE.Group();
    holder.add(m.root);
    st.scene.add(holder);
    st.bot = holder;
    const size = Math.max(d.chassis.length + d.chassis.wedgeLength + (d.weapon.type === 'spinner' ? d.weapon.radius : 0), d.chassis.width, d.drive.wheelDiameter);
    st.cam.position.set(size * 1.05 + 0.25, size * 0.7 + 0.2, size * 1.05 + 0.25);
    st.cam.lookAt(0, 0.12, 0);
    void s;
  }, [d]);
  return <div className="preview"><canvas ref={ref} /></div>;
}
