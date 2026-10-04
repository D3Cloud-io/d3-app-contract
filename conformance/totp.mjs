// RFC 6238 TOTP for the suite's test accounts: the suite signs in as a person would, so it needs the
// account's codes. (Clients never compute codes; a conformance suite has to.)
import { createHmac } from "node:crypto";

export function base32Decode(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`not base32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret, { time = Date.now(), period = 30, digits = 6 } = {}) {
  const counter = Math.floor(time / 1000 / period);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Codes for one secret that are never used twice: products may refuse a replayed code, so when this
 * time step's code is spent the next call waits for the next step.
 */
export function codeSource(secret, { reuseAllowed = false, period = 30 } = {}) {
  const used = new Set();
  return async function next() {
    for (;;) {
      const step = Math.floor(Date.now() / 1000 / period);
      if (reuseAllowed || !used.has(step)) {
        used.add(step);
        return totp(secret, { period });
      }
      const wait = (step + 1) * period * 1000 - Date.now() + 250;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  };
}
