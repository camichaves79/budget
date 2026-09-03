export function ProgressBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const over = max > 0 && value > max;
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const barColor = color ?? (over ? 'var(--danger)' : 'var(--accent)');
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress-fill" style={{ width: `${pct}%`, background: barColor }} />
    </div>
  );
}
