import { KEY_LABELS } from '../input';

export interface SettingsState {
  hazards: boolean;
  koCount: 'broadcast' | 'rulebook';
  matchSeconds: number;
  announcer: boolean;
  volume: number;
  quality: 'high' | 'low';
}
const KEY = 'killsaws.settings.v1';
export const DEFAULT_SETTINGS: SettingsState = { hazards: true, koCount: 'broadcast', matchSeconds: 180, announcer: true, volume: 0.8, quality: 'high' };
export function loadSettings(): SettingsState {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULT_SETTINGS; }
}
export function saveSettings(s: SettingsState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function Settings({ value, onChange, onBack }: { value: SettingsState; onChange: (s: SettingsState) => void; onBack: () => void }) {
  const set = <K extends keyof SettingsState>(k: K, v: SettingsState[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="screen">
      <div className="topbar"><button className="btn small" onClick={onBack}>← Back</button><h2>Settings &amp; Controls</h2></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 520px) 1fr', gap: 24 }}>
        <div className="opts">
          <label>Arena hazards <input type="checkbox" checked={value.hazards} onChange={(e) => set('hazards', e.target.checked)} /></label>
          <label>KO count
            <select value={value.koCount} onChange={(e) => set('koCount', e.target.value as SettingsState['koCount'])}>
              <option value="broadcast">10 count (as on TV)</option>
              <option value="rulebook">20 count, last 10 called (2021 rulebook)</option>
            </select>
          </label>
          <label>Match length
            <select value={value.matchSeconds} onChange={(e) => set('matchSeconds', Number(e.target.value))}>
              <option value={180}>3:00 (official)</option>
              <option value={120}>2:00</option>
              <option value={60}>1:00 (killsaws live the whole time)</option>
            </select>
          </label>
          <label>Announcer voice <input type="checkbox" checked={value.announcer} onChange={(e) => set('announcer', e.target.checked)} /></label>
          <label>Volume <input type="range" min={0} max={1} step={0.05} value={value.volume} onChange={(e) => set('volume', Number(e.target.value))} /></label>
          <label>Graphics
            <select value={value.quality} onChange={(e) => set('quality', e.target.value as SettingsState['quality'])}>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
          </label>
          <p className="flag">Rules follow the 2021 BattleBots tournament rules: no tap-outs; a pin or lift is limited to a 10 count before the refs separate you; killsaws fire in the final minute; each team controls its own Pulverizer; three judges score Damage 5, Aggression 3, Control 3.</p>
        </div>
        <div className="opts">
          <div className="keys">
            <span />
            <b style={{ color: 'var(--red)' }}>Red: keyboard 1</b><b style={{ color: 'var(--blue)' }}>Blue: keyboard 2</b><b>Gamepad</b>
            {(['drive', 'weapon', 'alt', 'flame', 'hazard'] as const).map((k) => (
              <Row key={k} label={{ drive: 'Drive (arcade)', weapon: 'Weapon (spinner on/off, fire)', alt: 'Secondary / self-right / reverse', flame: 'Flamethrower', hazard: 'Your Pulverizer' }[k]}
                a={KEY_LABELS.kb1[k]} b={KEY_LABELS.kb2[k]} c={KEY_LABELS.pad[k]} />
            ))}
          </div>
          <p className="flag">In a fight: <b>C</b> cycles cameras (broadcast, chase, overhead, free orbit). <b>Esc</b> pauses. Spinners toggle: tap the weapon key to spin up, tap again to cut power. Controls auto-invert when you're flipped.</p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, a, b, c }: { label: string; a: string; b: string; c: string }) {
  return (<><span>{label}</span><span>{a}</span><span>{b}</span><span>{c}</span></>);
}
