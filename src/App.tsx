import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell, Camera, CheckCheck, ChevronRight, CircleUserRound, Gamepad2,
  Image, MessageCircle, MoreVertical, Paperclip, Phone, Plus, Search,
  Send, Settings, Shield, Smile, Video, X, Mic, Users, PencilLine, Pin
} from "lucide-react";

type Message = {
  id: number;
  author: string;
  text: string;
  time: string;
  mine?: boolean;
  image?: boolean;
  attachment?: { name: string; type: string; data: string; size: number };
  poll?: { question: string; options: { id: string; text: string; votes: string[] }[] };
  edited?: boolean;
  createdAt?: number;
  replyTo?: { author: string; text: string };
  reactions?: string[];
};

type Chat = {
  id: number;
  name: string;
  avatar: string;
  color: string;
  preview: string;
  time: string;
  unread?: number;
  group?: boolean;
  members?: string[];
  inviteCode?: string;
  pinned?: boolean;
  messages: Message[];
};

const initialChats: Chat[] = [
  {
    id: 1, name: "Друзья", avatar: "👥", color: "group", preview: "Кто сегодня играет?", time: "19:42", unread: 2, group: true,
    messages: [
      { id: 1, author: "Максим", text: "Кто сегодня играет?", time: "19:32" },
      { id: 2, author: "Игорь", text: "Я в 20:00 буду, можем в доту или кс?", time: "19:35" },
      { id: 3, author: "Алексей", text: "Давайте в доту, я как раз хотел потренироваться", time: "19:37", mine: true },
      { id: 4, author: "Аня", text: "Я тоже за! 🙂", time: "19:38" },
      { id: 5, author: "Сергей", text: "Топ, собираемся в 20:00", time: "19:40" },
    ]
  },
  {
    id: 2, name: "Максим", avatar: "М", color: "blue", preview: "Скинь потом ссылку 🙂", time: "18:37", unread: 1,
    messages: [{ id: 1, author: "Максим", text: "Скинь потом ссылку 🙂", time: "18:37" }]
  },
  {
    id: 3, name: "Аня", avatar: "А", color: "pink", preview: "Хорошо, давай!", time: "17:23",
    messages: [{ id: 1, author: "Аня", text: "Хорошо, давай!", time: "17:23" }]
  },
  {
    id: 4, name: "Игорь", avatar: "И", color: "olive", preview: "Встретимся в 20:00?", time: "16:12",
    messages: [{ id: 1, author: "Игорь", text: "Встретимся в 20:00?", time: "16:12" }]
  },
  {
    id: 5, name: "Общие", avatar: "👥", color: "group", preview: "Максим: Погнали в доту?", time: "14:05", unread: 4, group: true,
    messages: [{ id: 1, author: "Максим", text: "Погнали в доту?", time: "14:05" }]
  },
  {
    id: 6, name: "Сергей", avatar: "С", color: "orange", preview: "Ок, понял", time: "12:48",
    messages: [{ id: 1, author: "Сергей", text: "Ок, понял", time: "12:48" }]
  },
  {
    id: 7, name: "Катя", avatar: "К", color: "pink", preview: "Спасибо! 🙂", time: "11:20",
    messages: [{ id: 1, author: "Катя", text: "Спасибо! 🙂", time: "11:20" }]
  },
];

const friends = [
  { name: "Максим", avatar: "М", color: "blue" },
  { name: "Игорь", avatar: "И", color: "olive" },
  { name: "Аня", avatar: "А", color: "pink" },
  { name: "Сергей", avatar: "С", color: "orange" },
  { name: "Катя", avatar: "К", color: "pink" },
  { name: "Дима", avatar: "Д", color: "blue" },
  { name: "Настя", avatar: "Н", color: "pink" },
  { name: "Влад", avatar: "В", color: "olive" },
];

const games = [
  { name: "Шахматы", desc: "Играть с друзьями", icon: "♟", cls: "chess" },
  { name: "Uno", desc: "Быстрая игра", icon: "UNO", cls: "uno" },
  { name: "Балда", desc: "Слова и друзья", icon: "А", cls: "balda" },
];

function Avatar({ children, color = "blue", small = false }: { children: React.ReactNode; color?: string; small?: boolean }) {
  return <div className={`avatar ${color} ${small ? "small" : ""}`}>{children}</div>;
}

export default function App() {
  const [chats, setChats] = useState<Chat[]>(() => {
    try {
      const saved = window.localStorage.getItem("nexus-chats-v1");
      return saved ? (JSON.parse(saved) as Chat[]) : initialChats;
    } catch {
      return initialChats;
    }
  });
  const [activeId, setActiveId] = useState(1);
  const [draft, setDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [search, setSearch] = useState("");
  const [chatFilter, setChatFilter] = useState<"all" | "unread" | "pinned" | "groups">("all");
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<number, string>>(() => { try { return JSON.parse(window.localStorage.getItem("nexus-drafts-v1") || "{}") as Record<number, string>; } catch { return {}; } });
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatName, setNewChatName] = useState("");
  const [newChatIsGroup, setNewChatIsGroup] = useState(false);
  const [groupMembersInput, setGroupMembersInput] = useState("Максим, Аня");
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedRef = useRef(0);
  const [mentionOpen, setMentionOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeNav, setActiveNav] = useState("Чаты");
  const [notice, setNotice] = useState("");
  const [showProfile, setShowProfile] = useState(true);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState(() => window.localStorage.getItem("nexus-profile-name") || "Алексей");
  const [profileAvatar, setProfileAvatar] = useState(() => window.localStorage.getItem("nexus-profile-avatar") || "А");
  const [theme, setTheme] = useState(() => window.localStorage.getItem("nexus-theme") || "yellow");
  const [activeGame, setActiveGame] = useState<string | null>(null);
  const [gameNotice, setGameNotice] = useState("");
  const [chessSolved, setChessSolved] = useState(false);
  const [unoHand, setUnoHand] = useState(["🔴 3", "🔵 7", "🟡 2", "🟢 5", "🔴 9"]);
  const [unoTop, setUnoTop] = useState("🔵 4");
  const [baldaInput, setBaldaInput] = useState("");
  const [baldaWords, setBaldaWords] = useState<string[]>([]);
  const [baldaScore, setBaldaScore] = useState(0);
  const [openMessageActionsId, setOpenMessageActionsId] = useState<number | null>(null);
  const [deletedMessage, setDeletedMessage] = useState<{ chatId: number; message: Message; index: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeChat = chats.find((chat) => chat.id === activeId) ?? chats[0];
  const sortedChats = useMemo(() => [...chats].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))), [chats]);
  const visibleMessages = useMemo(() => { const q = messageSearch.trim().toLocaleLowerCase("ru-RU"); return activeChat.messages.filter((message) => !q || message.text.toLocaleLowerCase("ru-RU").includes(q) || message.author.toLocaleLowerCase("ru-RU").includes(q)); }, [activeChat, messageSearch]);
  const galleryImages = useMemo(() => chats.flatMap((chat) => chat.messages.filter((message) => message.attachment?.type.startsWith("image/")).map((message) => ({ ...message, chatName: chat.name }))), [chats]);
  const mentionQuery = draft.match(/(?:^|\s)@([^\s@]*)$/)?.[1] ?? null;
  const mentionMatches = mentionQuery === null ? [] : [...new Set([profileName, ...friends.map((friend) => friend.name), ...(activeChat.members ?? [])])].filter((name) => name.toLocaleLowerCase("ru-RU").startsWith(mentionQuery.toLocaleLowerCase("ru-RU"))).slice(0, 6);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("nexus-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("nexus-profile-name", profileName);
    window.localStorage.setItem("nexus-profile-avatar", profileAvatar);
  }, [profileName, profileAvatar]);

  useEffect(() => { window.localStorage.setItem("nexus-drafts-v1", JSON.stringify(drafts)); }, [drafts]);

  useEffect(() => {
    try {
      window.localStorage.setItem("nexus-chats-v1", JSON.stringify(chats));
    } catch {
      // The app remains usable if browser storage is unavailable.
    }
  }, [chats]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeId, activeChat.messages.length]);

  const filteredChats = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return chats;
    return chats.filter((chat) =>
      chat.name.toLowerCase().includes(query) ||
      chat.preview.toLowerCase().includes(query) ||
      chat.messages.some((message) => message.text.toLowerCase().includes(query))
    );
  }, [chats, search]);

  function clockTime() {
    return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  }

  function handleAttachment(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 1_500_000) { action("Файл слишком большой: максимум 1,5 МБ для локального хранения"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const data = typeof reader.result === "string" ? reader.result : "";
      if (!data) { action("Не удалось прочитать файл"); return; }
      const time = clockTime(); const createdAt = Date.now();
      const message: Message = { id: createdAt, author: profileName, text: file.name, time, mine: true, createdAt, attachment: { name: file.name, type: file.type || "application/octet-stream", data, size: file.size } };
      setChats((current) => current.map((chat) => chat.id === activeId ? { ...chat, preview: `📎 ${file.name}`, time, messages: [...chat.messages, message] } : chat));
      action("Файл прикреплён и сохранён в этом браузере");
    };
    reader.onerror = () => action("Не удалось прочитать файл");
    reader.readAsDataURL(file);
  }

  function createChat(event: FormEvent) {
    event.preventDefault();
    const name = newChatName.trim();
    if (!name) return;
    const existing = chats.find((chat) => chat.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"));
    if (existing) { setActiveId(existing.id); setNewChatOpen(false); setNewChatName(""); action("Этот чат уже существует"); return; }
    const id = Date.now();
    const members = newChatIsGroup ? [...new Set([profileName, ...groupMembersInput.split(",").map((item) => item.trim()).filter(Boolean)])] : undefined;
    const inviteCode = newChatIsGroup ? Math.random().toString(36).slice(2, 10) : undefined;
    const created: Chat = { id, name, avatar: newChatIsGroup ? "👥" : name.slice(0, 1).toUpperCase(), color: newChatIsGroup ? "group" : "blue", preview: newChatIsGroup ? "Группа создана" : "Новый чат", time: clockTime(), messages: [], ...(newChatIsGroup ? { group: true, members, inviteCode } : {}) };
    setChats((current) => [created, ...current]); setActiveId(id); setDraft(""); setNewChatName(""); setNewChatIsGroup(false); setNewChatOpen(false); setActiveNav("Чаты"); action(newChatIsGroup ? `Группа «${name}» создана локально` : `Чат «${name}» создан локально`);
  }

  function chooseMention(name: string) {
    setDraft((current) => current.replace(/(?:^|\s)@[^\s@]*$/, (match) => `${match.startsWith(" ") ? " " : ""}@${name} `));
    setMentionOpen(false);
  }

  function createPoll(event: FormEvent) {
    event.preventDefault();
    const question = pollQuestion.trim(); const options = pollOptions.map((text) => text.trim()).filter(Boolean);
    if (!question || options.length < 2) { action("Для опроса нужны вопрос и минимум два варианта"); return; }
    const time = clockTime(); const createdAt = Date.now();
    const message: Message = { id: createdAt, author: profileName, text: question, time, mine: true, createdAt, poll: { question, options: options.map((text, index) => ({ id: `${createdAt}-${index}`, text, votes: [] })) } };
    setChats((current) => current.map((chat) => chat.id === activeId ? { ...chat, preview: `📊 ${question}`, time, messages: [...chat.messages, message] } : chat));
    setPollOpen(false); setPollQuestion(""); setPollOptions(["", ""]); action("Опрос создан");
  }

  function votePoll(messageId: number, optionId: string) {
    setChats((current) => current.map((chat) => chat.id !== activeId ? chat : ({ ...chat, messages: chat.messages.map((message) => message.id !== messageId || !message.poll ? message : ({ ...message, poll: { ...message.poll, options: message.poll.options.map((option) => ({ ...option, votes: option.votes.includes(profileName) ? option.votes.filter((vote) => vote !== profileName) : option.id === optionId ? [...option.votes, profileName] : option.votes.filter((vote) => vote !== profileName) })) } })) })));
  }

  async function startVoiceRecording() {
    if (recording) { mediaRecorderRef.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { action("Запись аудио не поддерживается этим браузером"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream); mediaRecorderRef.current = recorder; recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recordingStartedRef.current = Date.now();
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop()); setRecording(false);
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) { action("Запись получилась пустой"); return; }
        if (blob.size > 1_500_000) { action("Аудио больше 1,5 МБ. Попробуй записать короче"); return; }
        const reader = new FileReader();
        reader.onload = () => { const data = typeof reader.result === "string" ? reader.result : ""; if (!data) return; const time = clockTime(); const createdAt = Date.now(); const duration = Math.max(1, Math.round((Date.now() - recordingStartedRef.current) / 1000)); const message: Message = { id: createdAt, author: profileName, text: `Голосовое сообщение · ${duration} сек.`, time, mine: true, createdAt, attachment: { name: `voice-${createdAt}.webm`, type: blob.type || "audio/webm", data, size: blob.size } }; setChats((current) => current.map((chat) => chat.id === activeId ? { ...chat, preview: "🎤 Голосовое сообщение", time, messages: [...chat.messages, message] } : chat)); setRecordingSeconds(0); action("Голосовое сообщение добавлено в чат"); }; reader.readAsDataURL(blob);
      };
      recorder.start(); setRecording(true); setRecordingSeconds(0);
      const startedAt = Date.now(); const tick = window.setInterval(() => { if (mediaRecorderRef.current?.state !== "recording") { window.clearInterval(tick); return; } setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000)); }, 500);
    } catch { action("Нет доступа к микрофону. Разреши запись аудио в браузере"); }
  }

  function createInviteLink() {
    if (!activeChat.group) { action("Приглашения доступны для групповых чатов"); return; }
    const code = activeChat.inviteCode || Math.random().toString(36).slice(2, 10);
    const link = `${window.location.origin}${window.location.pathname}?join=${code}`;
    setChats((current) => current.map((chat) => chat.id === activeId ? { ...chat, inviteCode: code } : chat));
    navigator.clipboard?.writeText(link).then(() => action("Ссылка-приглашение скопирована")).catch(() => action(`Ссылка: ${link}`));
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (editingMessageId !== null) {
      const text = editDraft.trim();
      if (!text) return;
      setChats((current) => current.map((chat) => chat.id !== activeId ? chat : {
        ...chat,
        preview: chat.messages[chat.messages.length - 1]?.id === editingMessageId ? text : chat.preview,
        messages: chat.messages.map((message) => message.id === editingMessageId ? { ...message, text, edited: true } : message),
      }));
      setEditingMessageId(null);
      setEditDraft("");
      return;
    }
    const text = draft.trim();
    if (!text) return;
    const createdAt = Date.now();
    const time = clockTime();
    const replyTo = replyTarget ? { author: replyTarget.author, text: replyTarget.text } : undefined;
    setChats((current) => current.map((chat) => chat.id === activeId
      ? { ...chat, preview: text, time, messages: [...chat.messages, { id: createdAt, author: profileName, text, time, mine: true, createdAt, ...(replyTo ? { replyTo } : {}) }] }
      : chat
    ));
    setDraft("");
    setDrafts((current) => ({ ...current, [activeId]: "" }));
    setReplyTarget(null);
  }

  function startEditing(message: Message) {
    setEditingMessageId(message.id);
    setEditDraft(message.text);
    setDraft("");
  }

  function toggleReaction(messageId: number, emoji: string) {
    setChats((current) => current.map((chat) => chat.id !== activeId ? chat : ({
      ...chat,
      messages: chat.messages.map((message) => message.id !== messageId ? message : ({
        ...message,
        reactions: message.reactions?.includes(emoji) ? message.reactions.filter((item) => item !== emoji) : [...(message.reactions ?? []), emoji],
      })),
    })));
    setOpenMessageActionsId(null);
  }

  function openGame(name: string) {
    setActiveGame(name);
    setGameNotice("");
    if (name === "Шахматы") setChessSolved(false);
    if (name === "Uno") { setUnoHand(["🔴 3", "🔵 7", "🟡 2", "🟢 5", "🔴 9"]); setUnoTop("🔵 4"); }
    if (name === "Балда") { setBaldaInput(""); setBaldaWords([]); setBaldaScore(0); }
  }

  function playUnoCard(card: string) {
    const cardColor = card.slice(0, 2);
    const topColor = unoTop.slice(0, 2);
    const cardNumber = card.trim().slice(-1);
    const topNumber = unoTop.trim().slice(-1);
    if (cardColor !== topColor && cardNumber !== topNumber) {
      setGameNotice("Можно положить карту того же цвета или числа.");
      return;
    }
    const nextHand = unoHand.filter((item) => item !== card);
    const colors = ["🔴", "🔵", "🟡", "🟢"];
    const nextCard = `${colors[Math.floor(Math.random() * colors.length)]} ${Math.floor(Math.random() * 9) + 1}`;
    setUnoHand(nextHand);
    setUnoTop(nextCard);
    setGameNotice(nextHand.length === 0 ? "УНО! Ты выиграл раунд 🎉" : "Карта сыграна! Ход виртуального соперника завершён.");
  }

  function drawUnoCard() {
    const colors = ["🔴", "🔵", "🟡", "🟢"];
    const card = `${colors[Math.floor(Math.random() * colors.length)]} ${Math.floor(Math.random() * 9) + 1}`;
    setUnoHand((hand) => [...hand, card]);
    setGameNotice("Ты взял карту. Теперь можно сыграть подходящую.");
  }

  function submitBaldaWord(event: FormEvent) {
    event.preventDefault();
    const word = baldaInput.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
    if (word.length < 3 || !/^[а-я]+$/.test(word)) { setGameNotice("Введи русское слово минимум из 3 букв."); return; }
    if (baldaWords.includes(word)) { setGameNotice("Это слово уже использовано."); return; }
    setBaldaWords((words) => [...words, word]);
    setBaldaScore((score) => score + word.length);
    setBaldaInput("");
    setGameNotice(`Принято: +${word.length} очков!`);
  }

  function togglePinned(chatId: number) {
    setChats((current) => current.map((chat) => chat.id === chatId ? { ...chat, pinned: !chat.pinned } : chat));
  }

  function deleteMessage(messageId: number) {
    const chat = chats.find((item) => item.id === activeId);
    const index = chat?.messages.findIndex((message) => message.id === messageId) ?? -1;
    const message = index >= 0 ? chat?.messages[index] : undefined;
    if (!chat || !message) return;
    setDeletedMessage({ chatId: activeId, message, index });
    setChats((current) => current.map((item) => {
      if (item.id !== activeId) return item;
      const wasLast = item.messages[item.messages.length - 1]?.id === messageId;
      const messages = item.messages.filter((entry) => entry.id !== messageId);
      const last = messages[messages.length - 1];
      return { ...item, messages, preview: wasLast ? (last?.text ?? "Нет сообщений") : item.preview, time: wasLast ? (last?.time ?? "") : item.time };
    }));
    setOpenMessageActionsId(null);
    if (editingMessageId === messageId) {
      setEditingMessageId(null);
      setEditDraft("");
    }
  }

  function undoDelete() {
    if (!deletedMessage) return;
    setChats((current) => current.map((chat) => {
      if (chat.id !== deletedMessage.chatId) return chat;
      const messages = [...chat.messages];
      messages.splice(Math.min(deletedMessage.index, messages.length), 0, deletedMessage.message);
      const last = messages[messages.length - 1];
      return { ...chat, messages, preview: last?.text ?? "Нет сообщений", time: last?.time ?? "" };
    }));
    setDeletedMessage(null);
  }

  function dateLabel(timestamp: number) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(date, today)) return "Сегодня";
    if (sameDay(date, yesterday)) return "Вчера";
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined }).format(date);
  }

  function action(label: string) {
    setNotice(label);
    window.setTimeout(() => setNotice(""), 2600);
  }

  return (
    <main className="app-shell">
      <aside className="rail">
        <button className="brand" onClick={() => setActiveNav("Чаты")} aria-label="Nexus — главная">
          <span className="brand-mark">M</span><span className="brand-name">Nexus</span>
        </button>

        <nav className="main-nav">
          <button className={`nav-link ${activeNav === "Чаты" ? "active" : ""}`} onClick={() => setActiveNav("Чаты")}>
            <MessageCircle size={22}/><span>Чаты</span><b className="nav-count">3</b>
          </button>
          <button className={`nav-link ${activeNav === "Звонки" ? "active" : ""}`} onClick={() => { setActiveNav("Звонки"); action("Звонки подключим на следующем этапе"); }}>
            <Phone size={22}/><span>Звонки</span>
          </button>
          <button className={`nav-link ${activeNav === "Видео" ? "active" : ""}`} onClick={() => { setActiveNav("Видео"); action("Видеозвонки подключим на следующем этапе"); }}>
            <Video size={22}/><span>Видео</span>
          </button>
          <button className={`nav-link ${activeNav === "Мини-игры" ? "active" : ""}`} onClick={() => { setActiveNav("Мини-игры"); openGame("Каталог"); }}>
            <Gamepad2 size={22}/><span>Мини-игры</span>
          </button>
          <div className="nav-divider"/>
          <button className={`nav-link ${activeNav === "Настройки" ? "active" : ""}`} onClick={() => { setActiveNav("Настройки"); setProfileOpen(true); }}>
            <Settings size={22}/><span>Настройки</span>
          </button>
        </nav>

        <button className="self-profile" onClick={() => setProfileOpen(true)}>
          <Avatar color="self">{profileAvatar}</Avatar>
          <span className="self-copy"><strong>{profileName}</strong><small><i/>В сети</small></span>
          <Settings size={18} className="self-settings"/>
        </button>
      </aside>

      <section className="chat-list-panel">
        <div className="search-row">
          <label className="search-box"><Search size={18}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск чатов и сообщений..."/></label>
          <button className="square-action" onClick={() => setNewChatOpen(true)} aria-label="Новый чат" title="Создать чат"><PencilLine size={20}/></button>
        </div>
        <div className="chat-filters">{([{id:"all",label:"Все"},{id:"unread",label:"Непрочитанные"},{id:"pinned",label:"Закреплённые"},{id:"groups",label:"Группы"}] as const).map((filter) => <button key={filter.id} className={chatFilter === filter.id ? "active" : ""} onClick={() => setChatFilter(filter.id)}>{filter.label}</button>)}</div>
        <div className="chat-list">
          {sortedChats.filter((chat) => (chatFilter === "all" || (chatFilter === "unread" && Boolean(chat.unread)) || (chatFilter === "pinned" && Boolean(chat.pinned)) || (chatFilter === "groups" && Boolean(chat.group))) && (!search.trim() || filteredChats.some((item) => item.id === chat.id))).map((chat) => (
            <button key={chat.id} className={`chat-row ${chat.id === activeId ? "selected" : ""}`} onContextMenu={(event) => { event.preventDefault(); togglePinned(chat.id); action(chat.pinned ? "Чат откреплён" : "Чат закреплён"); }} onClick={() => { setActiveId(chat.id); setDraft(drafts[chat.id] ?? ""); setMessageSearch(""); setChats((current) => current.map((item) => item.id === chat.id ? { ...item, unread: 0 } : item)); }}>
              <Avatar color={chat.color}>{chat.avatar}</Avatar>
              <span className="chat-row-copy"><strong>{chat.pinned && <span className="pinned-mark">📌 </span>}{chat.name}</strong><small>{chat.preview}</small></span>
              <span className="chat-meta"><small>{chat.time}</small>{chat.unread ? <b>{chat.unread}</b> : chat.id !== activeId ? <CheckCheck size={15}/> : null}</span>
            </button>
          ))}
          {sortedChats.filter((chat) => (chatFilter === "all" || (chatFilter === "unread" && Boolean(chat.unread)) || (chatFilter === "pinned" && Boolean(chat.pinned)) || (chatFilter === "groups" && Boolean(chat.group))) && (!search.trim() || filteredChats.some((item) => item.id === chat.id))).length === 0 && <div className="empty-search">По этим фильтрам чатов нет</div>}
        </div>
      </section>

      <section className="conversation-panel">
        <header className="conversation-header">
          <Avatar color={activeChat.color}>{activeChat.avatar}</Avatar>
          <div className="conversation-title"><strong>{activeChat.name}</strong><small>{activeChat.group ? `${activeChat.members?.length ?? 1} участника(ов)` : "Локальный чат"}</small></div>
          <div className="conversation-tools">
            <button onClick={() => setMessageSearchOpen((open) => !open)} aria-label="Поиск по переписке" title="Поиск по переписке"><Search/></button>
            <button onClick={() => action("Голосовые звонки подключим позже")} aria-label="Позвонить"><Phone/></button>
            <button onClick={() => action("Видеозвонки подключим позже")} aria-label="Видеозвонок"><Video/></button>
            <button onClick={() => { togglePinned(activeChat.id); action(activeChat.pinned ? "Чат откреплён" : "Чат закреплён"); }} aria-label={activeChat.pinned ? "Открепить чат" : "Закрепить чат"} title={activeChat.pinned ? "Открепить чат" : "Закрепить чат"}><Pin/></button><button onClick={() => setShowProfile(!showProfile)} aria-label="Показать профиль"><MoreVertical/></button>
          </div>
        </header>

        {messageSearchOpen && <label className="message-search"><Search size={16}/><input autoFocus value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} placeholder="Найти сообщение в этом чате..."/><span>{visibleMessages.length}</span><button type="button" onClick={() => { setMessageSearchOpen(false); setMessageSearch(""); }} aria-label="Закрыть поиск"><X size={15}/></button></label>}
        <div className="messages-area">
          {activeChat.messages.length > 0 && !activeChat.messages.some((message) => message.createdAt) && <div className="date-divider"><span>История переписки</span></div>}
          {visibleMessages.length === 0 && <div className="empty-search">{messageSearch.trim() ? "Сообщения не найдены" : "Пока нет сообщений. Напиши первым!"}</div>}
          {visibleMessages.map((message, index) => (
            <Fragment key={message.id}>
              {message.createdAt && (index === 0 || !activeChat.messages[index - 1]?.createdAt || dateLabel(message.createdAt) !== dateLabel(activeChat.messages[index - 1].createdAt!)) && <div className="date-divider"><span>{dateLabel(message.createdAt)}</span></div>}
              <div className={`message-line ${message.mine ? "mine" : ""}`}>
                {!message.mine && <Avatar color={friends.find((f) => f.name === message.author)?.color ?? "blue"} small>{message.author.slice(0, 1)}</Avatar>}
                <div className="message-content">
                  {!message.mine && <strong className="message-author">{message.author}</strong>}
                  <div className={`bubble ${message.mine ? "mine-bubble" : ""}`}>
                    {message.replyTo && <div className="reply-quote"><strong>{message.replyTo.author}</strong><span>{message.replyTo.text}</span></div>}
                    {message.poll ? <div className="poll-card"><strong>📊 {message.poll.question}</strong>{message.poll.options.map((option) => { const total = message.poll!.options.reduce((sum, item) => sum + item.votes.length, 0); const chosen = option.votes.includes(profileName); return <button type="button" className={`poll-option ${chosen ? "chosen" : ""}`} key={option.id} onClick={() => votePoll(message.id, option.id)}><span>{option.text}<b>{option.votes.length}</b></span><i style={{ width: `${total ? option.votes.length / total * 100 : 0}%` }}/></button>; })}<small>{message.poll.options.reduce((sum, option) => sum + option.votes.length, 0)} голос(ов) · можно изменить выбор</small></div> : message.attachment ? <div className="attachment-card">{message.attachment.type.startsWith("image/") ? <img className="attachment-image" src={message.attachment.data} alt={message.attachment.name}/> : message.attachment.type.startsWith("audio/") ? <div className="voice-attachment"><Mic size={17}/><audio controls src={message.attachment.data}/><a href={message.attachment.data} download={message.attachment.name}>Скачать</a></div> : <a className="attachment-file" href={message.attachment.data} download={message.attachment.name}><Paperclip size={18}/><span><strong>{message.attachment.name}</strong><small>{Math.max(1, Math.round(message.attachment.size / 1024))} КБ · Скачать</small></span></a>}<span className="attachment-caption">{message.attachment.name}</span></div> : message.text.split(/(@[\p{L}\p{N}_]+)/gu).map((part, partIndex) => part.startsWith("@") ? <strong className="message-mention" key={partIndex}>{part}</strong> : part)}<span className="message-time">{message.edited ? "изменено · " : ""}{message.time}</span>
                  </div>
                  {message.reactions && message.reactions.length > 0 && <div className="reaction-list">{message.reactions.map((emoji, reactionIndex) => <button key={emoji + reactionIndex} type="button" onClick={() => toggleReaction(message.id, emoji)}>{emoji}</button>)}</div>}
                  <div className="message-action-wrap">
                    <button type="button" className="message-menu-toggle" onClick={() => setOpenMessageActionsId(openMessageActionsId === message.id ? null : message.id)} aria-label="Действия с сообщением"><MoreVertical size={15}/></button>
                    {openMessageActionsId === message.id && <div className="message-actions">
                      <button type="button" onClick={() => { setReplyTarget(message); setOpenMessageActionsId(null); }}><MessageCircle size={13}/> Ответить</button>
                      <button type="button" onClick={() => { navigator.clipboard?.writeText(message.text).then(() => action("Текст скопирован")).catch(() => action("Не удалось скопировать текст")); setOpenMessageActionsId(null); }}><Paperclip size={13}/> Копировать</button>
                      <button type="button" onClick={() => toggleReaction(message.id, "❤️")}>❤️</button>
                      <button type="button" onClick={() => toggleReaction(message.id, "👍")}>👍</button>
                      {message.mine && <button type="button" onClick={() => { startEditing(message); setOpenMessageActionsId(null); }} aria-label="Редактировать сообщение"><PencilLine size={13}/> Изменить</button>}
                      {message.mine && <button type="button" onClick={() => deleteMessage(message.id)} aria-label="Удалить сообщение"><X size={13}/> Удалить</button>}
                    </div>}
                  </div>
                  {activeChat.id === 1 && index === activeChat.messages.length - 1 && !message.mine && (
                    <div className="game-preview">
                      <div className="game-art"><span>D</span><div className="art-orb orb-one"/><div className="art-orb orb-two"/><div className="art-orb orb-three"/></div>
                      <div className="game-info"><div><strong>Dota 2</strong><small>5 игроков · 19:42</small></div><button onClick={() => action("Приглашение в игру скоро появится")}><Send size={16}/></button></div>
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {editingMessageId !== null && <div className="edit-banner">Редактирование сообщения <button type="button" onClick={() => { setEditingMessageId(null); setEditDraft(""); }} aria-label="Отменить редактирование"><X size={15}/></button></div>}
        {replyTarget && <div className="reply-banner"><span><strong>Ответ для {replyTarget.author}</strong><small>{replyTarget.text}</small></span><button type="button" onClick={() => setReplyTarget(null)} aria-label="Отменить ответ"><X size={15}/></button></div>}
        <form className="composer" onSubmit={sendMessage}>
          <input ref={fileInputRef} type="file" className="hidden-file-input" accept="image/*,.pdf,.txt,.doc,.docx,.zip,.csv" onChange={handleAttachment} />
          <button type="button" className="attach-button" onClick={() => setGalleryOpen(true)} aria-label="Галерея медиа" title="Галерея изображений"><Image size={20}/></button>
          <button type="button" className="attach-button" onClick={() => setPollOpen(true)} aria-label="Создать опрос" title="Создать опрос"><Users size={19}/></button>
          <input ref={fileInputRef} type="file" className="hidden-file-input" accept="image/*,.pdf,.txt,.doc,.docx,.zip,.csv" onChange={handleAttachment} />
          <button type="button" className="attach-button" onClick={() => fileInputRef.current?.click()} aria-label="Прикрепить файл" title="Прикрепить файл"><Paperclip size={21}/></button>
          <div className="composer-input-wrap"><input value={editingMessageId !== null ? editDraft : draft} onChange={(e) => { if (editingMessageId !== null) setEditDraft(e.target.value); else { setDraft(e.target.value); setDrafts((current) => ({ ...current, [activeId]: e.target.value })); setMentionOpen(e.target.value.includes("@")); } }} placeholder={editingMessageId !== null ? "Изменить сообщение..." : "Написать сообщение..."} aria-label="Текст сообщения"/>
          {mentionOpen && mentionMatches.length > 0 && <div className="mention-suggestions">{mentionMatches.map((name) => <button type="button" key={name} onClick={() => chooseMention(name)}>@{name}</button>)}</div>}</div>
          <button type="button" className="emoji-button" onClick={() => editingMessageId !== null ? setEditDraft((v) => v + " 🙂") : setDraft((v) => v + " 🙂")} aria-label="Добавить эмодзи"><Smile size={20}/></button>
          <button type="button" className={`attach-button voice-button ${recording ? "recording" : ""}`} onClick={startVoiceRecording} aria-label={recording ? "Остановить запись" : "Записать голосовое"} title={recording ? `Остановить запись · ${recordingSeconds} сек.` : "Голосовое сообщение"}><Mic size={20}/>{recording && <span>{recordingSeconds}s</span>}</button>
          <button type="submit" className="send-button" aria-label={editingMessageId !== null ? "Сохранить изменения" : "Отправить сообщение"} disabled={!(editingMessageId !== null ? editDraft : draft).trim()}>{editingMessageId !== null ? <CheckCheck size={20}/> : <Send size={20}/>}</button>
        </form>
      </section>

      {showProfile && <aside className="right-panel">
        <div className="right-heading"><span>Профиль</span><button className="mobile-close" onClick={() => setShowProfile(false)}><X size={17}/></button></div>
        <button className="profile-card" onClick={() => setProfileOpen(true)}>
          <Avatar color="self">{profileAvatar}</Avatar>
          <span><strong>{profileName}</strong><small><i/>В сети</small></span>
          <ChevronRight size={22} className="yellow-icon"/>
        </button>

        <div className="right-divider"/>
        <div className="online-heading"><span><i/>Онлайн</span><b>12</b></div>
        <div className="friends-list">
          {friends.map((friend) => <button key={friend.name} className="friend-row" onClick={() => {
            const existing = chats.find((chat) => chat.name === friend.name);
            if (existing) setActiveId(existing.id);
            else action(`Открыть чат с ${friend.name} — скоро`);
          }}>
            <span className="friend-avatar-wrap"><Avatar color={friend.color} small>{friend.avatar}</Avatar><i/></span>
            <span>{friend.name}</span>
          </button>)}
          <button className="invite-row" onClick={createInviteLink}><span><Plus size={22}/></span>{activeChat.group ? "Скопировать ссылку-приглашение" : "Приглашение доступно в группах"}</button>
        </div>

        <div className="right-divider games-divider"/>
        <button className="games-heading" onClick={() => { setActiveNav("Мини-игры"); openGame("Каталог"); }}><Gamepad2 size={22}/><strong>Мини-игры</strong><ChevronRight size={20}/></button>
        <button className="clear-history-button" onClick={() => { if (!activeChat.messages.length) { action("История уже пуста"); return; } if (window.confirm(`Удалить всю историю чата «${activeChat.name}» на этом устройстве?`)) { setChats((current) => current.map((chat) => chat.id === activeId ? { ...chat, messages: [], preview: "История очищена", time: "" } : chat)); setDeletedMessage(null); action("История чата очищена"); } }}>Очистить историю этого чата</button>
        <div className="games-list">
          {games.map((game) => <button key={game.name} className="game-row" onClick={() => openGame(game.name)}>
            <span className={`game-icon ${game.cls}`}>{game.icon}</span><span><strong>{game.name}</strong><small>{game.desc}</small></span>
          </button>)}
        </div>
      </aside>}


      {activeGame && <div className="modal-backdrop game-backdrop" onClick={() => setActiveGame(null)}>
        <section className="game-modal" onClick={(event) => event.stopPropagation()}>
          <header className="game-modal-header"><div><span className="game-modal-eyebrow">NEXUS ARCADE</span><h2>{activeGame === "Каталог" ? "Мини-игры" : activeGame}</h2></div><button type="button" onClick={() => setActiveGame(null)} aria-label="Закрыть игры"><X size={20}/></button></header>
          {activeGame === "Каталог" ? <div className="game-picker">
            {games.map((game) => <button key={game.name} className="game-picker-card" onClick={() => openGame(game.name)}><span className={`game-icon ${game.cls}`}>{game.icon}</span><strong>{game.name}</strong><small>{game.desc}</small><span className="game-play-label">Играть <ChevronRight size={15}/></span></button>)}
          </div> : null}
          {activeGame === "Шахматы" && <div className="chess-game">
            <p className="game-instructions">Шахматная разминка: белые ходят. Как лучше продолжить позицию?</p>
            <div className="chess-board" aria-label="Шахматная доска">
              {["♜","♞","♝","♛","♚","♝","♞","♜", ...Array(8).fill("♟"), ...Array(32).fill(""), ...Array(8).fill("♙"), "♖","♘","♗","♕","♔","♗","♘","♖"].map((piece,index) => <div key={index} className={`chess-square ${(Math.floor(index/8)+index%8)%2===0?"light":"dark"}`}>{piece}</div>)}
            </div>
            <strong className="game-question">Как называется ход, который одновременно атакует короля?</strong>
            <div className="chess-answers">{["Рокировка","Шах","Пат"].map((answer) => <button key={answer} onClick={() => { setChessSolved(true); setGameNotice(answer === "Шах" ? "Верно! ♟️ Король под атакой." : "Не совсем. Правильный ответ — «Шах»." ); }}>{answer}</button>)}</div>
            {chessSolved && <button className="game-secondary" onClick={() => {setChessSolved(false);setGameNotice("");}}>Попробовать ещё раз</button>}
          </div>}
          {activeGame === "Uno" && <div className="uno-game">
            <p className="game-instructions">Сыграй карту того же цвета или числа, что и верхняя карта. Соперник виртуальный.</p>
            <div className="uno-table"><span>Карта на столе</span><div className="uno-card top-card">{unoTop}</div><small>Карт у тебя: {unoHand.length}</small></div>
            <strong className="game-question">Твои карты</strong>
            <div className="uno-hand">{unoHand.map((card,index) => <button key={card+index} className={`uno-card card-${card.slice(0,2)==="🔴"?"red":card.slice(0,2)==="🔵"?"blue":card.slice(0,2)==="🟡"?"yellow":"green"}`} onClick={() => playUnoCard(card)}>{card}</button>)}</div>
            <button className="game-secondary" onClick={drawUnoCard}>Взять карту +1</button>
          </div>}
          {activeGame === "Балда" && <div className="balda-game">
            <p className="game-instructions">Составляй русские слова. Каждое новое слово приносит очки по числу букв. Это локальная тренировка.</p>
            <div className="balda-board">{["Б","А","Л","Д","А"].map((letter,index)=><span key={index}>{letter}</span>)}</div>
            <div className="balda-score"><span>Твои очки</span><strong>{baldaScore}</strong><small>слов: {baldaWords.length}</small></div>
            <form className="balda-form" onSubmit={submitBaldaWord}><input value={baldaInput} onChange={(event)=>setBaldaInput(event.target.value)} placeholder="Введи слово..." maxLength={20}/><button type="submit">Добавить</button></form>
            {baldaWords.length > 0 && <div className="balda-words">{baldaWords.map((word,index)=><span key={word}>{word} <b>+{word.length}</b></span>)}</div>}
          </div>}
          {gameNotice && <div className="game-feedback" role="status">{gameNotice}</div>}
          {activeGame !== "Каталог" && <button className="game-back-link" onClick={() => openGame("Каталог")}>← Все мини-игры</button>}
        </section>
      </div>}
\n      {newChatOpen && <div className="modal-backdrop" onClick={() => setNewChatOpen(false)}><form className="settings-modal" onSubmit={createChat} onClick={(event) => event.stopPropagation()}><header><strong>Новый чат</strong><button type="button" onClick={() => setNewChatOpen(false)} aria-label="Закрыть"><X size={18}/></button></header><p className="modal-help">Создай диалог или локальную группу. Данные сохраняются в этом браузере.</p><label>Имя чата<input autoFocus value={newChatName} maxLength={48} onChange={(event) => setNewChatName(event.target.value)} placeholder="Например, Команда" required /></label><label className="group-toggle"><input type="checkbox" checked={newChatIsGroup} onChange={(event) => setNewChatIsGroup(event.target.checked)}/> Создать группу</label>{newChatIsGroup && <label>Участники через запятую<input value={groupMembersInput} onChange={(event) => setGroupMembersInput(event.target.value)} placeholder="Максим, Аня, Игорь"/></label>}<button type="submit" className="save-settings">Создать</button></form></div>}
      {pollOpen && <div className="modal-backdrop" onClick={() => setPollOpen(false)}><form className="settings-modal" onSubmit={createPoll} onClick={(event) => event.stopPropagation()}><header><strong>Новый опрос</strong><button type="button" onClick={() => setPollOpen(false)} aria-label="Закрыть"><X size={18}/></button></header><label>Вопрос<input autoFocus value={pollQuestion} maxLength={180} onChange={(event) => setPollQuestion(event.target.value)} placeholder="Что выбираем?" required/></label>{pollOptions.map((option, index) => <label key={index}>Вариант {index+1}<input value={option} maxLength={80} onChange={(event) => setPollOptions((current) => current.map((item, i) => i === index ? event.target.value : item))} placeholder={`Вариант ${index+1}`}/></label>)}{pollOptions.length < 6 && <button type="button" className="game-secondary" onClick={() => setPollOptions((current) => [...current, ""])}>+ Добавить вариант</button>}<button type="submit" className="save-settings">Опубликовать опрос</button></form></div>}
      {galleryOpen && <div className="modal-backdrop" onClick={() => setGalleryOpen(false)}><section className="settings-modal gallery-modal" onClick={(event) => event.stopPropagation()}><header><strong>Галерея медиа</strong><button type="button" onClick={() => setGalleryOpen(false)} aria-label="Закрыть"><X size={18}/></button></header><p className="modal-help">Изображения из всех локальных чатов</p>{galleryImages.length ? <div className="media-gallery">{galleryImages.map((image) => <button type="button" key={`${image.id}-${image.chatName}`} onClick={() => { setActiveId(chats.find((chat) => chat.name === image.chatName)?.id ?? activeId); setGalleryOpen(false); }} title={`${image.chatName} · ${image.attachment?.name}`}><img src={image.attachment!.data} alt={image.attachment!.name}/><small>{image.chatName}</small></button>)}</div> : <div className="empty-search">Пока нет изображений. Прикрепи картинку к сообщению.</div>}</section></div>}
      {profileOpen && <div className="modal-backdrop" onClick={() => setProfileOpen(false)}><section className="settings-modal" onClick={(event) => event.stopPropagation()}><header><strong>Профиль и оформление</strong><button type="button" onClick={() => setProfileOpen(false)} aria-label="Закрыть"><X size={18}/></button></header><label>Имя<input value={profileName} maxLength={32} onChange={(event) => setProfileName(event.target.value)} /></label><label>Буква или эмодзи аватара<input value={profileAvatar} maxLength={3} onChange={(event) => setProfileAvatar(event.target.value)} /></label><label>Цветовая тема<select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="yellow">Nexus — жёлтая</option><option value="blue">Синяя</option><option value="violet">Фиолетовая</option><option value="mint">Мятная</option></select></label><button type="button" className="save-settings" onClick={() => { setProfileOpen(false); action("Профиль и тема сохранены"); }}>Готово</button></section></div>}
      {deletedMessage && <div className="toast undo-toast"><span>Сообщение удалено</span><button className="undo-button" onClick={undoDelete}>Отменить</button><button onClick={() => setDeletedMessage(null)} aria-label="Закрыть"><X size={15}/></button></div>}
      {notice && <div className="toast"><Shield size={17}/>{notice}<button onClick={() => setNotice("")}><X size={15}/></button></div>}
      <button className="mobile-profile-toggle" onClick={() => setShowProfile(!showProfile)} aria-label="Профиль"><CircleUserRound/></button>
    </main>
  );
}
