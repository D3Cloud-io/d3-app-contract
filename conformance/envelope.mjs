// The relay envelope, version 1 (spec/push.md), for the suite's mock relay to open what a product
// sends, and for the reference product to seal it. WebCrypto only.
const INFO = new TextEncoder().encode("d3-relay-envelope-v1");
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
};

async function key(privateKey, publicRaw, ephemeralRaw, devicePublicRaw, usage) {
  const peer = await crypto.subtle.importKey("raw", publicRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, privateKey, 256));
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: concat(ephemeralRaw, devicePublicRaw), info: INFO },
    hkdf, { name: "AES-GCM", length: 256 }, false, [usage]);
}

/** Seals a payload to a device public key given as base64 X9.63. */
export async function seal(devicePublicKey, payload) {
  const devicePub = Buffer.from(devicePublicKey, "base64");
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ephemeralPub = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const aes = await key(ephemeral.privateKey, devicePub, ephemeralPub, devicePub, "encrypt");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: INFO }, aes,
    new TextEncoder().encode(JSON.stringify(payload))));
  return Buffer.from(concat(new Uint8Array([1]), ephemeralPub, nonce, sealed)).toString("base64");
}

/** Opens an envelope with a device key pair; throws when it isn't one. */
export async function open(envelope, deviceKeyPair) {
  const data = new Uint8Array(Buffer.from(envelope, "base64"));
  if (data.length < 1 + 65 + 12 + 16 || data[0] !== 1) throw new Error("not a version 1 envelope");
  const ephemeralPub = data.slice(1, 66);
  const nonce = data.slice(66, 78);
  const devicePub = new Uint8Array(await crypto.subtle.exportKey("raw", deviceKeyPair.publicKey));
  const aes = await key(deviceKeyPair.privateKey, ephemeralPub, ephemeralPub, devicePub, "decrypt");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: INFO }, aes, data.slice(78));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** base64url(HMAC-SHA256(sendKey, `${timestamp}.${body}`)) — the relay's signature. */
export async function sign(sendKey, timestamp, body) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(sendKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${timestamp}.${body}`))).toString("base64url");
}
