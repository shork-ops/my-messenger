const fs = require("node:fs");

function patch(rel, edits) {
  const raw = fs.readFileSync(rel, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  let lf = raw.replace(/\r\n/g, "\n");
  for (const [from, to, label] of edits) {
    if (!lf.includes(from)) {
      console.error("MISSING in " + rel + ": " + label);
      process.exit(1);
    }
    lf = lf.replace(from, to);
  }
  fs.writeFileSync(rel, eol === "\r\n" ? lf.replace(/\n/g, "\r\n") : lf, "utf8");
  console.log("patched " + rel);
}

// A four-digit badge does not fit; three digits already look absurd.
patch("src/lib/notifications.ts", [
  [
    `/** The Badging API accepts integers only; clamp to keep the badge readable. */`,
    `/**
 * What a badge may show.
 *
 * Past a hundred the exact number stops meaning anything and starts breaking the
 * layout, so it becomes "99+".
 */
export function badgeText(unread: number): string {
  if (unread <= 0) return "";
  return unread > 99 ? "99+" : String(unread);
}

/** The Badging API accepts integers only; clamp to keep the badge readable. */`,
    "badgeText",
  ],
]);

// Rail uses the formatted text and can announce the count to a screen reader.
patch("src/components/Rail.tsx", [
  [
    `          {unreadTotal > 0 && <b className="nav-count">{unreadTotal}</b>}`,
    `          {unreadTotal > 0 && (
            <b className="nav-count" aria-label={\`\${unreadTotal} непрочитанных\`}>
              {badgeText(unreadTotal)}
            </b>
          )}`,
    "rail badge",
  ],
]);
