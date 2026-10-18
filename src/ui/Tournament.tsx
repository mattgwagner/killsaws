import { BotDesign } from '../sim/design';
import { SeatConfig } from '../game';
import { SettingsState } from './Settings';
export interface TournamentState { pendingResult?: { winner: string; method: string; time: number } }
export function Tournament({ onBack }: { state: TournamentState | null; setState: (s: TournamentState | null) => void; onBack: () => void; onFight: (r: BotDesign, b: BotDesign, s: [SeatConfig, SeatConfig]) => void; settings: SettingsState }) {
  return <div className="screen"><div className="topbar"><button className="btn small" onClick={onBack}>← Back</button><h2>Giant Nut Tournament</h2></div><p className="sub">Being built right now…</p></div>;
}
