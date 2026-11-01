/**
 * The fresh-install check runs with the unit tests, so every CI run covers it: schema.sql and
 * every migration on an empty database, then again on top of themselves (scripts/check-install.mjs).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("a fresh Supabase project", () => {
  it("installs from schema.sql and the migrations, and again on top of itself", () => {
    const script = fileURLToPath(new URL("../scripts/check-install.mjs", import.meta.url));
    const output = execFileSync(process.execPath, [script], { encoding: "utf8" });
    expect(output).toContain("PASS");
  }, 120_000);
});
