import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell, Camera, CheckCheck, ChevronRight, CircleUserRound, Gamepad2,
  Image, MessageCircle, MoreVertical, Paperclip, Phone, Plus, Search,
  Send, Settings, Shield, Smile, Video, X, Mic, Users, PencilLine
} from "lucide-react";

type Message = {
  id: number;
  author: string;
  text: string;
  time: string;
  mine?: boolean;
  image?: boolean;
  edited?: boolean;
  createdAt?: number;
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
  const [activeNav, setActiveNav] = useState("Чаты");
  const [notice, setNotice] = useState("");
  const [showProfile, setShowProfile] = useState(true);
  const [openMessageActionsId, setOpenMessageActionsId] = useState<number | null>(null);
  const [deletedMessage, setDeletedMessage] = useState<{ chatId: number; message: Message; index: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeChat = chats.find((chat) => chat.id === activeId) ?? chats[0];

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
    setChats((current) => current.map((chat) => chat.id === activeId
      ? { ...chat, preview: text, time, messages: [...chat.messages, { id: createdAt, author: "Алексей", text, time, mine: true, createdAt }] }
      : chat
    ));
    setDraft("");
  }

  function startEditing(message: Message) {
    setEditingMessageId(message.id);
    setEditDraft(message.text);
    setDraft("");
  }

  function deleteMessage(messageId: number) {
    const chat = chats.find((item) => item.id === activeId);
    const index = chat?.messages.findIndex((message) => message.id === messageId) ?? -1;
    const message = index >= 0 ? chat?.messages[index] : undefined;
    if (!chat || !message) return;
    setDeletedMessage({ chatId: activeId, message, index });
    setChats((current) => current.map((item) => {
      if (item.id !== activeId) return item;
      const messages = item.messages.filter((entry) => entry.id !== messageId);
      const last = messages[messages.length - 1];
      return { ...item, messages, preview: last?.text ?? "Нет сообщений", time: last?.time ?? "" };
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
          <button className={`nav-link ${activeNav === "Мини-игры" ? "active" : ""}`} onClick={() => { setActiveNav("Мини-игры"); action("Игры пока представлены макетом"); }}>
            <Gamepad2 size={22}/><span>Мини-игры</span>
          </button>
          <div className="nav-divider"/>
          <button className={`nav-link ${activeNav === "Настройки" ? "active" : ""}`} onClick={() => { setActiveNav("Настройки"); action("Настройки добавим позже"); }}>
            <Settings size={22}/><span>Настройки</span>
          </button>
        </nav>

        <button className="self-profile" onClick={() => action("Профиль пользователя")}>
          <Avatar color="self">А</Avatar>
          <span className="self-copy"><strong>Алексей</strong><small><i/>В сети</small></span>
          <Settings size={18} className="self-settings"/>
        </button>
      </aside>

      <section className="chat-list-panel">
        <div className="search-row">
          <label className="search-box"><Search size={18}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск чатов..."/></label>
          <button className="square-action" onClick={() => action("Создание нового чата скоро появится")} aria-label="Новый чат"><PencilLine size={20}/></button>
        </div>
        <div className="chat-list">
          {filteredChats.map((chat) => (
            <button key={chat.id} className={`chat-row ${chat.id === activeId ? "selected" : ""}`} onClick={() => { setActiveId(chat.id); setChats((current) => current.map((item) => item.id === chat.id ? { ...item, unread: 0 } : item)); }}>
              <Avatar color={chat.color}>{chat.avatar}</Avatar>
              <span className="chat-row-copy"><strong>{chat.name}</strong><small>{chat.preview}</small></span>
              <span className="chat-meta"><small>{chat.time}</small>{chat.unread ? <b>{chat.unread}</b> : chat.id !== activeId ? <CheckCheck size={15}/> : null}</span>
            </button>
          ))}
          {filteredChats.length === 0 && <div className="empty-search">Чаты не найдены</div>}
        </div>
      </section>

      <section className="conversation-panel">
        <header className="conversation-header">
          <Avatar color={activeChat.color}>{activeChat.avatar}</Avatar>
          <div className="conversation-title"><strong>{activeChat.name}</strong><small>{activeChat.group ? "5 участников" : "В сети"}</small></div>
          <div className="conversation-tools">
            <button onClick={() => action("Поиск по переписке скоро появится")} aria-label="Поиск"><Search/></button>
            <button onClick={() => action("Голосовые звонки подключим позже")} aria-label="Позвонить"><Phone/></button>
            <button onClick={() => action("Видеозвонки подключим позже")} aria-label="Видеозвонок"><Video/></button>
            <button onClick={() => setShowProfile(!showProfile)} aria-label="Показать профиль"><MoreVertical/></button>
          </div>
        </header>

        <div className="messages-area">
          {activeChat.messages.length > 0 && !activeChat.messages.some((message) => message.createdAt) && <div className="date-divider"><span>История переписки</span></div>}
          {activeChat.messages.map((message, index) => (
            <React.Fragment key={message.id}>
            {message.createdAt && (index === 0 || !activeChat.messages[index - 1]?.createdAt || dateLabel(message.createdAt) !== dateLabel(activeChat.messages[index - 1].createdAt!)) && <div className="date-divider"><span>{dateLabel(message.createdAt)}</span></div>}
            <div className={`message-line ${message.mine ? "mine" : ""}`}>
              {!message.mine && <Avatar color={friends.find((f) => f.name === message.author)?.color ?? "blue"} small>{message.author.slice(0, 1)}</Avatar>}
              <div className="message-content">
                {!message.mine && <strong className="message-author">{message.author}</strong>}
                <div className={`bubble ${message.mine ? "mine-bubble" : ""}`}>{message.text}<span className="message-time">{message.edited ? "изменено · " : ""}{message.time}</span></div>
                {message.mine && <div className="message-action-wrap">
                  <button type="button" className="message-menu-toggle" onClick={() => setOpenMessageActionsId(openMessageActionsId === message.id ? null : message.id)} aria-label="Действия с сообщением"><MoreVertical size={15}/></button>
                  {openMessageActionsId === message.id && <div className="message-actions">
                    <button type="button" onClick={() => { startEditing(message); setOpenMessageActionsId(null); }} aria-label="Редактировать сообщение"><PencilLine size={13}/> Изменить</button>
                    <button type="button" onClick={() => deleteMessage(message.id)} aria-label="Удалить сообщение"><X size={13}/> Удалить</button>
                  </div>}
                </div>}
                {activeChat.id === 1 && index === activeChat.messages.length - 1 && !message.mine && (
                  <div className="game-preview">
                    <div className="game-art"><span>D</span><div className="art-orb orb-one"/><div className="art-orb orb-two"/><div className="art-orb orb-three"/></div>
                    <div className="game-info"><div><strong>Dota 2</strong><small>5 игроков · 19:42</small></div><button onClick={() => action("Приглашение в игру скоро появится")}><Send size={16}/></button></div>
                  </div>
                )}
              </div>
            </div>
            </React.Fragment>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {editingMessageId !== null && <div className="edit-banner">Редактирование сообщения <button type="button" onClick={() => { setEditingMessageId(null); setEditDraft(""); }} aria-label="Отменить редактирование"><X size={15}/></button></div>}
        <form className="composer" onSubmit={sendMessage}>
          <button type="button" className="attach-button" onClick={() => action("Загрузка файлов будет добавлена позже")} aria-label="Прикрепить файл"><Paperclip size={21}/></button>
          <input value={editingMessageId !== null ? editDraft : draft} onChange={(e) => editingMessageId !== null ? setEditDraft(e.target.value) : setDraft(e.target.value)} placeholder={editingMessageId !== null ? "Изменить сообщение..." : "Написать сообщение..."} aria-label="Текст сообщения"/>
          <button type="button" className="emoji-button" onClick={() => editingMessageId !== null ? setEditDraft((v) => v + " 🙂") : setDraft((v) => v + " 🙂")} aria-label="Добавить эмодзи"><Smile size={20}/></button>
          <button type="submit" className="send-button" aria-label={editingMessageId !== null ? "Сохранить изменения" : "Отправить сообщение"} disabled={!(editingMessageId !== null ? editDraft : draft).trim()}>{editingMessageId !== null ? <CheckCheck size={20}/> : <Send size={20}/>}</button>
        </form>
      </section>

      {showProfile && <aside className="right-panel">
        <div className="right-heading"><span>Профиль</span><button className="mobile-close" onClick={() => setShowProfile(false)}><X size={17}/></button></div>
        <button className="profile-card" onClick={() => action("Профиль Алексей")}>
          <Avatar color="self">А</Avatar>
          <span><strong>Алексей</strong><small><i/>В сети</small></span>
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
          <button className="invite-row" onClick={() => action("Ссылки-приглашения добавим при подключении сервера")}><span><Plus size={22}/></span>Пригласить друга</button>
        </div>

        <div className="right-divider games-divider"/>
        <button className="games-heading" onClick={() => { setActiveNav("Мини-игры"); action("Каталог игр скоро появится"); }}><Gamepad2 size={22}/><strong>Мини-игры</strong><ChevronRight size={20}/></button>
        <div className="games-list">
          {games.map((game) => <button key={game.name} className="game-row" onClick={() => action(`${game.name}: игра появится в следующем этапе`)}>
            <span className={`game-icon ${game.cls}`}>{game.icon}</span><span><strong>{game.name}</strong><small>{game.desc}</small></span>
          </button>)}
        </div>
      </aside>}

      {deletedMessage && <div className="toast undo-toast"><span>Сообщение удалено</span><button className="undo-button" onClick={undoDelete}>Отменить</button><button onClick={() => setDeletedMessage(null)} aria-label="Закрыть"><X size={15}/></button></div>}
      {notice && <div className="toast"><Shield size={17}/>{notice}<button onClick={() => setNotice("")}><X size={15}/></button></div>}
      <button className="mobile-profile-toggle" onClick={() => setShowProfile(!showProfile)} aria-label="Профиль"><CircleUserRound/></button>
    </main>
  );
}
