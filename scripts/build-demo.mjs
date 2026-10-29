/**
 * Runs a vite build with the temp directory inside the repository.
 *
 * On this machine esbuild cannot delete its scratch files from the system temp
 * directory — nine stale `esbuild-*` files were left there and every build died on
 * `EACCES` while removing one. Pointing TEMP and TMP at a folder in the project fixes
 * it, and keeps the scratch files somewhere we can clean up ourselves.
 *
 * Vite runs in-process rather than as a child: a child keeps the parent's handles open
 * on Windows and the build never returns. The exit code is still the build's own, so a
 * failure fails the command.
 *
 * Machine-specific by nature, which is why CI keeps calling `vite build` directly and
 * needs none of this.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";

const tempDir = join(process.cwd(), ".tmp", "build");
mkdirSync(tempDir, { recursive: true });
process.env.TEMP = tempDir;
process.env.TMP = tempDir;

try {
  await build({ mode: "demo" });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  // The scratch directory is disposable; leaving it behind would just accumulate.
  rmSync(tempDir, { recursive: true, force: true });
}
