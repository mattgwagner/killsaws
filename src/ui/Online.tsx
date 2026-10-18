import { BotDesign } from '../sim/design';
import { GameSession, FrameInfo } from '../game';
import { MatchResult } from '../sim/match';
import { NetGuest, NetHost } from '../net/net';
export function Online({ onBack }: { onBack: () => void; net: { host?: NetHost; guest?: NetGuest } | null; setNet: (n: { host?: NetHost; guest?: NetGuest } | null) => void; session: GameSession | null; onHostFight: (r: BotDesign, b: BotDesign) => void; onGuestStart: (d: [BotDesign, BotDesign]) => void; onGuestFrame: (f: FrameInfo) => void; onGuestResult: (r: MatchResult) => void }) {
  return <div className="screen"><div className="topbar"><button className="btn small" onClick={onBack}>← Back</button><h2>Fight Online</h2></div><p className="sub">Being built right now…</p></div>;
}
