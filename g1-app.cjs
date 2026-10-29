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
    `        chats={displayChats}
        allChats={chats}`,
    `        chats={folderChats}
        allChats={chats}`,
    "pass folder rows",
  ],
  [
    `        onFilterChange={setChatFilter}
        chats={folderChats}`,
    `        onFilterChange={setChatFilter}
        folders={folders}
        activeFolderId={activeFolderId}
        onSelectFolder={setActiveFolderId}
        onCreateFolder={createFolder}
        onDeleteFolder={(id) => {
          deleteFolder(id);
          if (activeFolderId === id) setActiveFolderId(null);
        }}
        chats={folderChats}`,
    "folder props",
  ],
  [
    `  const [shortcutsOpen, setShortcutsOpen] = useState(false);`,
    `  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { folders, createFolder, deleteFolder, toggleChat: toggleChatFolder } = useChatFolders();
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [folderPickerChat, setFolderPickerChat] = useState<Chat | null>(null);

  // A folder narrows the list rather than replacing it: search and the unread filter
  // still apply inside the folder, because those are what the reader is looking with.
  const folderChats = useMemo(() => {
    const folder = folders.find((item) => item.id === activeFolderId);
    if (!folder) return displayChats;
    const inFolder = new Set(chatsInFolder(folder, chats).map((chat) => chat.id));
    return displayChats.filter((chat) => inFolder.has(chat.id));
  }, [activeFolderId, chats, displayChats, folders]);`,
    "folder state",
  ],
  [
    `import { exportAsText, exportFileName, pluralMessages } from "./lib/exportChat";`,
    `import { exportAsText, exportFileName, pluralMessages } from "./lib/exportChat";
import { useChatFolders } from "./hooks/useChatFolders";
import { chatsInFolder } from "./lib/chatFolders";
import FolderPicker from "./components/FolderPicker";`,
    "imports",
  ],
  [
    `      {shortcutsOpen && <ShortcutHelp onClose={() => setShortcutsOpen(false)} />}`,
    `      {shortcutsOpen && <ShortcutHelp onClose={() => setShortcutsOpen(false)} />}

      {folderPickerChat && (
        <FolderPicker
          chat={folderPickerChat}
          folders={folders}
          onToggle={toggleChatFolder}
          onClose={() => setFolderPickerChat(null)}
        />
      )}`,
    "render picker",
  ],
]);
