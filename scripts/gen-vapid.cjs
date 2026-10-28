// Generates a VAPID key pair and writes it to a gitignored secret file
// without ever printing the private key to the console.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });

// VAPID public key: uncompressed P-256 point (0x04 || X || Y), base64url.
const publicJwk = publicKey.export({ format: "jwk" });
const privateJwk = privateKey.export({ format: "jwk" });
const x = Buffer.from(publicJwk.x, "base64url");
const y = Buffer.from(publicJwk.y, "base64url");
const d = Buffer.from(privateJwk.d, "base64url");
const publicRaw = Buffer.concat([Buffer.from([0x04]), x, y]).toString("base64url");
const privateRaw = d.toString("base64url");

const target = path.resolve(process.argv[2] || process.env.VAPID_OUT || ".env.vapid");
const lines = [
  "# Generated VAPID keys for Web Push. Do not commit this file.",
  `VAPID_PUBLIC_KEY=${publicRaw}`,
  `VAPID_PRIVATE_KEY=${privateRaw}`,
  "VAPID_SUBJECT=mailto:noreply@example.com",
  "",
].join("\n");
fs.writeFileSync(target, lines, { mode: 0o600 });
console.log("public key length:", publicRaw.length, "private key length:", privateRaw.length);
console.log("written to:", target);
