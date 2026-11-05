import { enforceAccountAccess } from "../_shared/accountAccess.ts";
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
import { publicPage } from "../_shared/publicPage.ts";
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

async function fetchCard(raw: string): Promise<Card> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("bad-url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad-scheme");

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await publicPage(url, MAX_BYTES, TIMEOUT_MS);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("bad-redirect");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error("fetch-failed");
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) throw new Error("not-html");
    return parseCard(await response.text(), url);
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

  if (!await enforceAccountAccess(client)) return new Response(JSON.stringify({ error: "Session expired or MFA required" }), { status: 403, headers: corsHeaders });

  const body = await request.json().catch(() => null);
  const url = body?.url;
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
