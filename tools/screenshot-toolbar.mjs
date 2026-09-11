/**
 * Measure the browser-UI (toolbar) region of an Android screenshot.
 *
 * Why: "is this a TWA in app mode?" is decided by whether a Custom Tab toolbar
 * is on screen, and that is a *pixel* question. `display: standalone` does NOT
 * answer it (a TWA that failed verification still reports standalone, and so
 * does a plain Custom Tab for an installable PWA), and `canPay=yes` is not a
 * signal either. This reads the framebuffer directly so the answer does not
 * depend on anyone's eyes.
 *
 * Usage:
 *   adb shell screencap -p /sdcard/s.png && adb pull /sdcard/s.png /tmp/s.png
 *   node tools/screenshot-toolbar.mjs /tmp/s.png
 *
 * Heuristic: walk rows from the top; the status bar and the toolbar are both
 * near-uniform, and the toolbar ends at the first row whose profile changes
 * sharply relative to the rows above. Reports the detected chrome height and,
 * for each row band, the dominant colour, so the caller can see the structure.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let width = 0,
    height = 0,
    bitDepth = 0,
    colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, pixels: out };
}

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: node tools/screenshot-toolbar.mjs <screenshot.png>');
  process.exit(2);
}
const img = decodePng(readFileSync(file));

/** Row statistics: mean colour and the fraction of pixels far from that mean. */
function rowStats(y) {
  const { width, channels, pixels } = img;
  let r = 0,
    g = 0,
    b = 0;
  for (let x = 0; x < width; x++) {
    const i = y * width * channels + x * channels;
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
  }
  r /= width;
  g /= width;
  b /= width;
  let busy = 0;
  for (let x = 0; x < width; x++) {
    const i = y * width * channels + x * channels;
    if (
      Math.abs(pixels[i] - r) > 40 ||
      Math.abs(pixels[i + 1] - g) > 40 ||
      Math.abs(pixels[i + 2] - b) > 40
    )
      busy++;
  }
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), busy: busy / width };
}

console.log(`image: ${img.width}x${img.height}, ${img.channels} channels`);

/** Mean colour of one row, sampled every 4px. */
function rowColour(y) {
  const { width, channels, pixels } = img;
  let r = 0,
    g = 0,
    b = 0;
  let n = 0;
  for (let x = 0; x < width; x += 4) {
    const i = y * width * channels + x * channels;
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
    n++;
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

console.log('\ncolour transitions down the top 700px (band boundaries):');
let prev = null;
for (let y = 0; y < Math.min(700, img.height); y++) {
  const c = rowColour(y);
  if (
    !prev ||
    Math.abs(c[0] - prev[0]) + Math.abs(c[1] - prev[1]) + Math.abs(c[2] - prev[2]) > 18
  ) {
    console.log(`  y=${String(y).padStart(3)}  rgb(${c.join(',')})`);
  }
  prev = c;
}

console.log('\nrow profile (every 8px, first 400px) — "busy" = non-uniform fraction:');
const rows = [];
for (let y = 0; y < Math.min(400, img.height); y += 8) {
  const s = rowStats(y);
  rows.push({ y, ...s });
  console.log(
    `  y=${String(y).padStart(3)}  rgb(${String(s.r).padStart(3)},${String(s.g).padStart(3)},${String(s.b).padStart(3)})  busy=${s.busy.toFixed(2)}`,
  );
}

// Chrome's toolbar is a flat light band (~#f1f3f4 / white) sitting below the
// status bar; the web content starts where a wide band of distinct rows ends.
const flatLight = rows.filter((r) => r.busy < 0.12 && r.r > 200 && r.g > 200 && r.b > 200);
console.log(`\nnear-uniform light rows in the top 400px: ${flatLight.length}`);
if (flatLight.length) {
  const last = flatLight[flatLight.length - 1];
  console.log(
    `  last such row at y=${last.y} -> browser chrome likely ends around y≈${last.y + 8}`,
  );
  console.log(
    '  (a TWA in APP MODE shows only the ~138px status bar here; a Custom Tab adds a toolbar on top of that)',
  );
}
console.log(`\nstatus-bar inset on this device was 138px (from DisplayFrames).`);
