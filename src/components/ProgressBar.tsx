/**
 * Horizontal progress bar.
 * Default color is percentage-based: green up to 50%, yellow up to 95%,
 * red at 95% and beyond (including over-budget). Pass `color` to override.
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
    color ?? (usage >= 95 ? 'var(--danger)' : usage > 50 ? 'var(--warning)' : 'var(--income)');
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
