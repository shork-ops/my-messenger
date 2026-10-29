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

// Rail needs the import.
patch("src/components/Rail.tsx", [
  [
    `import { Gamepad2,`,
    `import { badgeText } from "../lib/notifications";
import { Gamepad2,`,
    "badgeText import",
  ],
]);

// Muted and archived chats do not count toward the badge: a badge that includes
// chats you silenced on purpose teaches people to ignore the badge.
patch("src/hooks/useChatCollection.ts", [
  [
    `  const unreadTotal = useMemo(() => chats.reduce((sum, chat) => sum + (chat.unread ?? 0), 0), [chats]);`,
    `  // Muted and archived chats keep their own counts in the list but stay out of the
  // total: a badge that counts chats you silenced on purpose trains people to
  // ignore the badge.
  const unreadTotal = useMemo(
    () => attentionTotal(chats, new Date()),
    [chats]
  );`,
    "attention total",
  ],
]);
