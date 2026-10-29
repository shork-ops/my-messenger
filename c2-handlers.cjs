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

patch("src/App.tsx", [
  [
    `        onClearHistory={() => {
          setChatMenuOpen(false);
          clearHistory();
        }}`,
    `        onClearHistory={() => {
          setChatMenuOpen(false);
          clearHistory();
        }}
        onMute={() => {
          setChatMenuOpen(false);
          setMuteChatId(activeChat.id);
        }}
        onUnmute={() => {
          setChatMenuOpen(false);
          void saveChatSettings(activeChat.id, { mutedUntil: null }).then((ok) => ok && action("Звук включён"));
        }}
        onArchive={() => {
          setChatMenuOpen(false);
          const next = !activeChat.archived;
          void saveChatSettings(activeChat.id, { archived: next }).then(
            (ok) => ok && action(next ? "Чат в архиве" : "Чат возвращён из архива")
          );
        }}`,
    "menu handlers",
  ],
]);
