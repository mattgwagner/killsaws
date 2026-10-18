export function Files({ onBack }: { onBack: () => void }) {
  return <div className="screen"><div className="topbar"><button className="btn small" onClick={onBack}>← Back</button><h2>Robot Files</h2></div></div>;
}
