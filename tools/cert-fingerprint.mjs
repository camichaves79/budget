/**
 * Print the SHA-256 signing-certificate fingerprint(s) of a signed Android
 * artifact, in the exact `AA:BB:...` form `assetlinks.json` uses.
 *
 * Why: `.well-known/assetlinks.json` must list EVERY certificate the INSTALLED
 * app carries. Play publishes three (classical app-signing, post-quantum
 * app-signing, developer upload); the local build only ever carries the upload
 * key. Comparing this output against the file catches a fingerprint typo or a
 * stale keystore before it costs a device round trip
 * (skills/project-skill.md §10 item 2).
 *
 * Usage:
 *   node tools/cert-fingerprint.mjs android/app-release-signed.apk
 *   node tools/cert-fingerprint.mjs android/android.keystore <storepass> <alias>
 *
 * APK mode parses the APK Signing Block (scheme v2/v3) — no SDK, no JVM. It
 * reads the `certs` of the FIRST signer, which is the one Chrome compares.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const APK_SIG_BLOCK_MAGIC = 'APK Sig Block 42';
const EOCD_MAGIC = 0x06054b50;

const hex = (buf) =>
  [...buf].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');

const sha256 = (buf) => createHash('sha256').update(buf).digest();

/** Locate the APK Signing Block and return the scheme v2/v3 signature block. */
function findSigningBlock(apk) {
  // EOCD: scan back over the (max 64KiB) comment for the magic.
  let eocd = -1;
  const min = Math.max(0, apk.length - 0xffff - 22);
  for (let i = apk.length - 22; i >= min; i--) {
    if (apk.readUInt32LE(i) === EOCD_MAGIC) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD record not found (not a zip?)');

  const cdOffset = apk.readUInt32LE(eocd + 16);
  // The signing block sits immediately before the Central Directory and ends
  // with the 16-byte magic at the very end of that block.
  const magicAt = cdOffset - 16;
  if (apk.toString('binary', magicAt, magicAt + 16) !== APK_SIG_BLOCK_MAGIC) {
    throw new Error('APK Signing Block not found (v1-only / unsigned APK)');
  }
  const size2 = apk.readBigUInt64LE(cdOffset - 24);
  const blockStart = Number(BigInt(cdOffset - 8) - size2);

  // Sequence of (uint64 length, uint32 id, value) pairs, length INCLUDES the id.
  let p = blockStart + 8;
  while (p < cdOffset - 24) {
    const len = Number(apk.readBigUInt64LE(p));
    if (len === 0) break;
    const id = apk.readUInt32LE(p + 8);
    const value = apk.subarray(p + 12, p + 8 + len);
    if (id === 0x7109871a || id === 0xf05368c0) return value; // v2 | v3
    p += 8 + len;
  }
  throw new Error('no scheme v2/v3 block (a v1-signed APK carries no certs list)');
}

/** signer sequence -> first signer's `signed data` -> its certificates list. */
function firstSignerCerts(block) {
  const readLenPrefixed = (buf, off) => {
    const len = buf.readUInt32LE(off);
    return [buf.subarray(off + 4, off + 4 + len), off + 4 + len];
  };
  const [signers] = readLenPrefixed(block, 0);
  const [signer] = readLenPrefixed(signers, 0);
  const [signedData] = readLenPrefixed(signer, 0);
  // signed data: digests, certificates, [minSdk], [maxSdk], ...
  const [, afterDigests] = readLenPrefixed(signedData, 0);
  const [certs] = readLenPrefixed(signedData, afterDigests);
  const out = [];
  let p = 0;
  while (p < certs.length) {
    const [der, next] = readLenPrefixed(certs, p);
    out.push(der);
    p = next;
  }
  return out;
}

const [file, storepass, alias] = process.argv.slice(2);
if (!file) {
  console.error('usage: node tools/cert-fingerprint.mjs <apk|aab> [--keystore pass alias]');
  process.exit(2);
}

try {
  if (file.endsWith('.keystore') || file.endsWith('.jks')) {
    console.error(
      'keystore mode needs a JVM (keytool); this machine has none — use the APK.\n' +
        'Use it only if you have keytool: keytool -list -v -keystore <ks> -alias <alias>',
    );
    process.exit(3);
  }
  const apk = readFileSync(file);
  const certs = firstSignerCerts(findSigningBlock(apk));
  for (const der of certs) console.log(hex(sha256(der)));
  if (!certs.length) throw new Error('signer carried no certificates');
  void storepass;
  void alias;
} catch (err) {
  console.error(`cert-fingerprint: ${err.message}`);
  process.exit(1);
}
