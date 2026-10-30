// Supabase Edge Function: fetches the preview card for a link.
//
// Deploy:
//   supabase functions deploy link-preview
//
// Why a function at all: a browser cannot read another site's page (CORS), so the card has to
// be built somewhere with no such restriction. That "somewhere" is the part to be careful
// about, because it is now a machine in our infrastructure that will fetch any URL a user
// types. Three rules keep it from becoming a way to reach everything the server can reach:
//
//   1. Only http and https, and only to a public address. Loopback, private ranges and
//      link-local addresses are refused after DNS resolution, not before, because a hostname
//      can be made to resolve to 127.0.0.1.
//   2. The response is read with a size limit and a redirect cap. A page is not allowed to
//      make the function download gigabytes.
//   3. Only metadata is extracted - title, description, image, site name - and the HTML is
//      never executed, embedded or echoed back.
//
// The project's own tables are never touched here. Caching happens in the client, which
// already has a session and can store the card per URL in this browser.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 6000;

type Card = {
  url: string;
  title: string;
  description: string;
  image: string;
  site: string;
};

/** True for an address the function must not follow. */
function isPrivateAddress(host: string): boolean {
  // IPv4 literals, including the ranges that only exist inside a host.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const lowered = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (lowered === "::1" || lowered === "::" || lowered.startsWith("fc") || lowered.startsWith("fd")) return true;
  if (lowered.startsWith("fe80")) return true;
  // "localhost" and any name ending in it resolve to the loopback on most systems, and
  // refusing the names is the cheap half of the check - the DNS half happens below.
  if (lowered === "localhost" || lowered.endsWith(".localhost")) return true;
  return false;
}

/** Resolves a hostname and refuses if any resolved address is private. */
async function assertPublicHost(hostname: string): Promise<void> {
  if (isPrivateAddress(hostname)) throw new Error("private");
  // A hostname can point at a private address, so the name has to be resolved, not trusted.
  const records = await Deno.resolveDns(hostname, "A").catch(() => []);
  for (const address of records) {
    if (isPrivateAddress(address)) throw new Error("private");
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function meta(html: string, property: string): string {
  // Both attribute orders appear in the wild; a single pattern matching one of them silently
  // loses half the sites.
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const found = html.match(pattern);
    if (found?.[1]) return decodeEntities(found[1]).trim();
  }
  return "";
}

function parseCard(html: string, url: URL): Card {
  const title =
    meta(html, "og:title") ||
    decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const image = meta(html, "og:image");
  return {
    url: url.toString(),
    title: title.slice(0, 200),
    description: (meta(html, "og:description") || meta(html, "description")).slice(0, 300),
    // A relative image becomes absolute against the page, or it would never load.
    image: image ? new URL(image, url).toString() : "",
    site: meta(html, "og:site_name") || url.hostname.replace(/^www\./, ""),
  };
}

/** Reads at most MAX_BYTES of the response body. */
async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let text = "";
  let bytes = 0;
  while (bytes < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    // The card lives in the head; there is no reason to read a whole article.
    if (text.includes("</head>")) break;
  }
  await reader.cancel().catch(() => {});
  return text.slice(0, MAX_BYTES);
}

async function fetchCard(raw: string): Promise<Card> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("bad-url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad-scheme");

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(url.hostname);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Identify the bot honestly and ask for the cheap representation.
        "user-agent": "NexusMessengerBot/1.0 (+link preview)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ru,en;q=0.8",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("bad-redirect");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error("fetch-failed");
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) throw new Error("not-html");
    return parseCard(await readLimited(response), url);
  }
  throw new Error("too-many-redirects");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: corsHeaders });
  }

  // The caller must be a signed-in member of this project: an open fetcher on the internet
  // is a scanning service waiting to be found.
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "auth" }), { status: 401, headers: corsHeaders });
  }
  const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData } = await client.auth.getUser();
  if (!userData?.user) {
    return new Response(JSON.stringify({ error: "auth" }), { status: 401, headers: corsHeaders });
  }

  const { url } = await request.json().catch(() => ({ url: "" }));
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) {
    return new Response(JSON.stringify({ error: "bad-url" }), { status: 400, headers: corsHeaders });
  }

  try {
    const card = await fetchCard(url);
    return new Response(JSON.stringify(card), {
      headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "public, max-age=3600" },
    });
  } catch (error) {
    // The reason is returned so the client can tell "no preview" from "the site refused us",
    // but it is never a stack trace.
    return new Response(JSON.stringify({ error: String((error as Error).message ?? "fetch-failed") }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
