/**
 * Render the app icons from tools/icon.svg (the single source of truth).
 *
 *   npm_config_cache="$PWD/.npm-cache" npm install sharp --no-save
 *   node tools/render-icons.mjs
 *   npm uninstall --no-save sharp   # confirm package-lock.json stays clean
 *
 * Outputs: public/icon-512.png, public/icon-192.png, public/apple-touch-icon.png,
 * and public/favicon.svg (a small standalone SVG for browsers).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const svg = readFileSync(new URL('./icon.svg', import.meta.url));

await sharp(svg).resize(512, 512).png().toFile('public/icon-512.png');
await sharp(svg).resize(192, 192).png().toFile('public/icon-192.png');
await sharp(svg).resize(180, 180).png().toFile('public/apple-touch-icon.png');

// Favicon: browsers rasterize SVG themselves (system fonts), so keep it
// self-contained and visually matching.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#60c784"/>
  <rect x="13.1" y="30.7" width="73.8" height="38.7" rx="3" fill="none" stroke="#ffffff" stroke-width="3.5"/>
  <circle cx="31.4" cy="50" r="2" fill="#1b3022"/>
  <circle cx="68.4" cy="50" r="2" fill="#1b3022"/>
  <text x="50" y="59" font-size="25" font-family="Helvetica, Arial, sans-serif" font-weight="bold" text-anchor="middle" fill="#1b3022">$5</text>
</svg>
`;
writeFileSync('public/favicon.svg', favicon);

console.log('icons rendered');
