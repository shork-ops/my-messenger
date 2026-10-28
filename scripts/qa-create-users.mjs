// Creates (or reuses) two test accounts and prepares a direct chat between them.
// Credentials are written to a local, gitignored file; nothing is printed here.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const envText = fs.readFileSync(".env", "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    })
);

const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceKey = process.env.TEST_SERVICE_KEY;
if (!url || !serviceKey) {
  console.error("missing SUPABASE_URL or TEST_SERVICE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

// Passwords come from the environment: this file is committed, and a fixed
// password for a real (if disposable) account is still a credential.
for (const required of ["QA_ALPHA_PASSWORD", "QA_BETA_PASSWORD"]) {
  if (!process.env[required]) {
    console.error("missing " + required);
    process.exit(1);
  }
}

const accounts = [
  { email: "qa.alpha@nexus-test.local", password: process.env.QA_ALPHA_PASSWORD, name: "QA Alpha" },
  { email: "qa.beta@nexus-test.local", password: process.env.QA_BETA_PASSWORD, name: "QA Beta" },
];

const created = [];

for (const account of accounts) {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users?.find((user) => user.email === account.email);

  let userId;
  if (existing) {
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, { password: account.password, email_confirm: true });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: { display_name: account.name },
    });
    if (error) {
      console.error("create failed:", account.email, error.message);
      process.exit(1);
    }
    userId = data.user.id;
  }

  // The profile row is created by a trigger in some setups; make sure it exists.
  await admin.from("profiles").upsert(
    { id: userId, display_name: account.name, avatar: account.name.slice(3, 4) || "Q" },
    { onConflict: "id" }
  );

  created.push({ ...account, userId });
}

fs.writeFileSync(
  "qa-accounts.json",
  JSON.stringify({ url, anonKey: env.VITE_SUPABASE_PUBLISHABLE_KEY, accounts: created }, null, 2),
  "utf8"
);

console.log(JSON.stringify(created.map((a) => ({ email: a.email, id: a.userId })), null, 2));

