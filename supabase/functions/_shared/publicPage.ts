import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";

// Deliberately IPv4-only: IPv6 literals and transition mechanisms fail closed.
export function publicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export async function publicPage(url: URL, limit: number, timeout: number): Promise<Response> {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.port && url.port !== "80" && url.port !== "443")) throw new Error("bad-url");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const deadline = Date.now() + timeout;
  let timer: ReturnType<typeof setTimeout>;
  const operation = async () => {
    const addresses = isIP(hostname) ? [hostname] : await resolve4(hostname);
    if (Date.now() >= deadline) throw new Error("timeout");
    if (!addresses.length || !addresses.every(publicIpv4)) throw new Error("private");
    return await new Promise<Response>((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        agent: false,
        // The socket uses exactly the validated IP; TLS still verifies the URL hostname.
        lookup: (_host, _options, callback) => callback(null, addresses[0], 4),
        headers: { "user-agent": "NexusMessengerBot/1.0", accept: "text/html,application/xhtml+xml", "accept-encoding": "identity" },
      }, response => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          resolve(new Response(null, { status, headers: { location: response.headers.location ?? "" } }));
          response.destroy();
          return;
        }
        response.on("data", (chunk: Uint8Array) => {
          size += chunk.length;
          if (size > limit) { request.destroy(new Error("too-large")); return; }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const body = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
          resolve(new Response(body, { status, headers: { "content-type": String(response.headers["content-type"] ?? "") } }));
        });
      });
      request.on("error", reject);
      const abort = setTimeout(() => request.destroy(new Error("timeout")), Math.max(1, deadline - Date.now()));
      request.on("close", () => clearTimeout(abort));
      request.end();
    });
  };
  try {
    return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), timeout);
    })]);
  } finally { clearTimeout(timer!); }
}
