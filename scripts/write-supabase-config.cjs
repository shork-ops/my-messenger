const fs = require("fs");
const path = require("path");

// Prefer the real local env when present; fall back to .env.example.
const candidates = [".env", ".env.local", ".env.example"];
let projectUrl = "";
for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  const match = fs.readFileSync(file, "utf8").match(/^VITE_SUPABASE_URL=(.+)$/m);
  if (match && !/YOUR_PROJECT_REF/.test(match[1])) {
    projectUrl = match[1].trim();
    break;
  }
}
const ref = projectUrl ? projectUrl.replace(/^https?:\/\//, "").split(".")[0] : "YOUR_PROJECT_REF";

const config = `# Supabase CLI configuration for Nexus Messenger.
# project_id is the Supabase project reference (from the project URL).
# Run: npx supabase login && npx supabase link --project-ref ${ref}
project_id = "${ref}"

[api]
enabled = true
port = 54321
schemas = ["public", "storage", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
major_version = 17

[studio]
enabled = true
port = 54323

[storage]
enabled = true
file_size_limit = "50MiB"

# The push webhook cannot send a JWT, so verification is disabled for this function only.
[functions.push-notify]
verify_jwt = false
`;

fs.writeFileSync(path.join("supabase", "config.toml"), config, "utf8");
console.log("project_id:", ref);
