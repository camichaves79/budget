/**
 * Horizontal progress bar with tonal (non traffic-light) states:
 * mint fill 0–75%, engraving green 76–99%, copper at 100% and beyond.
 * Pass `color` to override.
 */
export function ProgressBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const usage = max > 0 ? (value / max) * 100 : 0;
  const barColor =
    color ?? (usage >= 100 ? 'var(--terracotta)' : usage >= 76 ? 'var(--primary)' : 'var(--accent)');
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
