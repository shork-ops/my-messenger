// Tests the actual HTTP handlers with an in-memory Supabase HTTP boundary.
// No live project, user data, credentials or Storage objects are touched.
let handler: (request: Request) => Promise<Response> | Response;
Object.defineProperty(Deno, "serve", { value: (next: typeof handler) => { handler = next; } });
Deno.env.set("SUPABASE_URL", "https://test.invalid");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "maintenance-test-key");
let calls = 0;
let claimed = false;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  calls++;
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://test.invalid/")) throw new Error("Live HTTP is forbidden in this test");
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  if (url.includes("/auth/v1/user")) {
    return Promise.resolve(Response.json(headers.get("Authorization") === "Bearer test-user" ? { id: "00000000-0000-0000-0000-000000000002" } : { message: "Unauthorized" }, { status: headers.get("Authorization") === "Bearer test-user" ? 200 : 401 }));
  }
  if (url.includes("/rpc/claim_view_once_message")) {
    if (claimed) return Promise.resolve(Response.json({ code: "P0001", message: "Media already opened" }, { status: 409 }));
    claimed = true;
    return Promise.resolve(Response.json({ path: "chat/sender/photo.jpg" }));
  }
  if (url.includes("/object/sign/view-once-media/")) return Promise.resolve(Response.json({ signedURL: "/object/sign/view-once-media/chat/sender/photo.jpg?token=one-use" }));
  throw new Error(`Unexpected test HTTP route: ${url}`);
}) as typeof fetch;
const request = (body: unknown, token = "test-user") => new Request("http://local.test", { method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body) });

Deno.test("cleanup rejects anonymous and ordinary account calls before touching Storage", async () => {
  await import("../functions/cleanup-media/index.ts");
  const before = calls;
  const anonymous = await handler(new Request("http://local.test", { method:"POST" }));
  const ordinary = await handler(request({},"test-user"));
  if (anonymous.status !== 401 || ordinary.status !== 401 || calls !== before) throw new Error("Unauthorized maintenance request reached Storage");
});

Deno.test("single-view handler issues one short URL and refuses a second device request", async () => {
  await import("../functions/view-once/index.ts");
  const id = "00000000-0000-0000-0000-000000000020";
  const first = await handler(request({ messageId:id }));
  const result = await first.json();
  if (first.status !== 200 || !result.url || result.seconds !== 10 || first.headers.get("Cache-Control") !== "no-store") throw new Error("Invalid single-view response");
  const second = await handler(request({ messageId:id }));
  if (second.status !== 409) throw new Error("Repeated claim succeeded");
  if ((await handler(request(null))).status !== 400) throw new Error("Malformed request accepted");
});
