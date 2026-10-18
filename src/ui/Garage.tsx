import { BotDesign } from '../sim/design';
export function Garage({ onBack }: { onBack: () => void; onTest: (d: BotDesign) => void }) {
  return <div className="screen"><div className="topbar"><button className="btn small" onClick={onBack}>← Back</button><h2>Garage</h2></div><p className="sub">Being built right now…</p></div>;
}
