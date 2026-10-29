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

patch("src/components/ConversationPanel.tsx", [
  [
    `import { ChevronLeft, MoreVertical, Phone, Pin, Search, Trash2, UserRound, Video, X } from "lucide-react";`,
    `import { Archive, BellOff, BellRing, ChevronLeft, MoreVertical, Phone, Pin, Search, Trash2, UserRound, Video, X } from "lucide-react";`,
    "icons",
  ],
]);
