// Tests the actual HTTP handlers with an in-memory Supabase HTTP boundary.
// No live project, user data, credentials or Storage objects are touched.
let handler: (request: Request) => Promise<Response> | Response;
Object.defineProperty(Deno, "serve", { configurable: true, value: (next: typeof handler) => { handler = next; } });
Deno.env.set("SUPABASE_URL", "https://test.invalid");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "maintenance-test-key");
let calls = 0;
let claimed = false;
let profileExists = true;
let authDeletes = 0;
let pushMessage: Record<string, unknown> = {};
let pushMembers: Record<string, unknown>[] = [];
let recipientQueries = 0;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  calls++;
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://test.invalid/")) throw new Error("Live HTTP is forbidden in this test");
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  if (url.includes("/auth/v1/user")) {
    return Promise.resolve(Response.json(headers.get("Authorization") === "Bearer test-user" ? { id: "00000000-0000-0000-0000-000000000002" } : { message: "Unauthorized" }, { status: headers.get("Authorization") === "Bearer test-user" ? 200 : 401 }));
  }
  if (url.includes("/rest/v1/profiles")) return Promise.resolve(Response.json(profileExists ? { id: "caller" } : null));
  if (url.includes("/auth/v1/admin/users/")) { if ((input instanceof Request ? input.method : init?.method) === "DELETE") authDeletes++; return Promise.resolve(Response.json({ user: { id: "00000000-0000-0000-0000-000000000002" } })); }
  if (url.includes("/rest/v1/messages")) return Promise.resolve(Response.json(pushMessage));
  if (url.includes("/rest/v1/chat_members")) { recipientQueries++; return Promise.resolve(Response.json(pushMembers)); }
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
Deno.test("push rejects missing, ordinary-user and incorrect webhook credentials", async () => {
  Deno.env.set("PUSH_WEBHOOK_SECRET", "dedicated-webhook-secret");
  await import("../functions/push-notify/index.ts");
  const before = calls;
  for (const token of ["", "test-user", "wrong-secret"]) {
    const response = await handler(request({ type: "INSERT", table: "messages", record: { id: "forged", chat_id: "victim", body: "forged" } }, token));
    if (response.status !== 401) throw new Error("Unauthorized webhook accepted");
  }
  if (calls !== before) throw new Error("Unauthorized push reached the database");
});

Deno.test("account auth deletion requires completed app-data cleanup", async () => {
  await import("../functions/delete-account/index.ts");
  if ((await handler(request({}))).status !== 409 || authDeletes !== 0) throw new Error("Deleted before cleanup");
  profileExists = false;
  const deleted = await handler(request({}));
  if (deleted.status !== 200 || Number(authDeletes) !== 1) throw new Error(`Cleaned account was not deleted: ${deleted.status} ${await deleted.text()} deletes=${authDeletes}`);
});

Deno.test("push suppresses future, deleted and expired messages and muted recipients", async () => {
  // Reuse the imported handler (Deno caches modules).
  const handlers: typeof handler[] = [];
  Object.defineProperty(Deno, "serve", { value: (next: typeof handler) => { handlers.push(next); }, configurable: true });
  await import("../functions/push-notify/index.ts?visibility");
  const push = handlers[0];
  const base = { id: "message", sender_id: "sender", chat_id: "chat", body: "secret" };
  const event = { type: "INSERT", table: "messages", record: { id: "message" } };
  const before = recipientQueries;
  for (const extra of [{ send_at: "2999-01-01T00:00:00Z" }, { deleted_at: "2020-01-01T00:00:00Z" }, { expires_at: "2020-01-01T00:00:00Z" }]) {
    pushMessage = { ...base, ...extra };
    const result = await push(request(event, "dedicated-webhook-secret"));
    if (result.status !== 200 || !(await result.json()).skipped) throw new Error("Hidden message reached push");
  }
  if (recipientQueries !== before) throw new Error("Hidden message queried recipients");
  pushMessage = base;
  pushMembers = [{ user_id: "sender" }, { user_id: "muted", muted_until: "2999-01-01T00:00:00Z" }];
  const result = await push(request(event, "dedicated-webhook-secret"));
  if (result.status !== 200 || !(await result.json()).skipped) throw new Error("Muted recipient received push");
});
