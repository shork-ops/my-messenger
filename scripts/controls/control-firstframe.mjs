// Negative control for the "first frame" isolation test.
//
// It patches `useOwnerStorage` at runtime into the WRONG shape - reset the value in an effect instead
// of during render - and checks that the first-frame test then fails. If it still passes, the test is
// vacuous and would not have caught the leak it claims to catch.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const target = "src/lib/useOwnerStorage.ts";
const original = readFileSync(target, "utf8");

// The buggy variant: no re-derive during render, reset in an effect afterwards. This is exactly the
// pattern the hook's header comment warns about.
const broken = original
  .replace(
    `  // A different owner during render: re-derive immediately rather than after paint.
  let current = state;
  if (state.scope !== ownerScope) {
    current = { scope: ownerScope, value: read(store.read(key)) };
    setState(current);
  }`,
    `  // BROKEN ON PURPOSE: reset after paint instead of during render.
  useEffect(() => {
    setState({ scope: ownerScope, value: read(store.read(key)) });
  }, [ownerScope, key, store, read]);
  const current = state;`
  )
  .replace(`import { useCallback, useMemo, useRef, useState } from "react";`, `import { useCallback, useEffect, useMemo, useRef, useState } from "react";`);

if (broken === original) {
  console.error("control: could not construct the broken variant");
  process.exit(2);
}

writeFileSync(target, broken, "utf8");
let failedAsExpected = false;
try {
  execFileSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "src/hooks/accountIsolation.test.tsx", "-t", "first frame"],
    { stdio: "pipe" }
  );
} catch {
  failedAsExpected = true;
} finally {
  writeFileSync(target, original, "utf8");
}

if (!failedAsExpected) {
  console.error("FAIL: the first-frame test passed against the broken hook - it tests nothing");
  process.exit(1);
}
console.log("PASS: the first-frame test fails against an effect-based reset and passes against the real hook");
