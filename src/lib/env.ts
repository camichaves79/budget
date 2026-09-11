/**
 * Environment label (2026-09, environment separation).
 *
 * The app is deployed to two Cloudflare Pages environments — production
 * (`5budget.app`, Production env vars) and staging (`staging.5budget.app`,
 * Preview env vars) — from the same code. Nothing in the bundle used to say
 * which one you were looking at, which is a real trap: an installed staging
 * app has the same name, the same icon and the same `display: standalone`
 * as the real one, and on this project that exact indistinguishability has
 * already cost hours (the Play Billing investigation).
 *
 * `VITE_ENV_LABEL` is a build-time var: set it to `staging` for the Preview
 * environment and leave it unset in Production. The label renders as a small
 * badge in the corner plus a suffix in Settings → About.
 */

/** The configured label; '' in any build that does not set it (production). */
export const ENV_LABEL = ((import.meta.env.VITE_ENV_LABEL as string | undefined) ?? '').trim();

/**
 * Pure: the badge text for a label. Empty (no badge) for production builds —
 * absent, blank, or an explicit 'production' all mean "this is the real app".
 */
export function envBadgeText(label: string): string {
  const value = label.trim();
  if (value === '' || value.toLowerCase() === 'production') return '';
  return value.toUpperCase();
}

/** The badge text for this build ('' = no badge). */
export const ENV_BADGE = envBadgeText(ENV_LABEL);

/** Pure: the Settings → About line, with the environment suffix when set. */
export function aboutLine(version: string, badge: string, aboutTitle: string): string {
  const suffix = badge === '' ? '' : ` · ${badge}`;
  return `Budget ${version}${suffix} · ${aboutTitle}`;
}
