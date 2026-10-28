import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { CircleUserRound, Shield, X } from "lucide-react";
import { supabase } from "./lib/supabase";
import Rail from "./components/Rail";
import ChatListPanel from "./components/ChatListPanel";
import ConversationPanel from "./components/ConversationPanel";
import RightPanel from "./components/RightPanel";
import GameModal from "./components/GameModal";
import { GalleryModal, NewChatModal, PollModal, ProfileModal } from "./components/Modals";
import { friends, isDemoMode } from "./lib/constants";
import { clockTime, numericId } from "./lib/format";
import {
  appendMessage,
  filterChats,
  getGalleryImages,
  getVisibleMessages,
  mapMessages,
  mapMessagesByRemoteId,
  markRead,
  matchesChatFilter,
  removeMessage,
  restoreMessage,
  sortChats,
  togglePinned,
  updateChat,
} from "./lib/chats";
import { toggleLocalVote } from "./lib/polls";
import type { Chat, ChatFilter, ChatMessageRow, Message, MessageEffect, UserSearchResult } from "./types";

export default function App() {
  const [chats, setChats] = useState<Chat[]>(() => {
    if (!isDemoMode) return [];
    if (!window.localStorage.getItem("nexus-demo-chats-cleared-v1")) {
      window.localStorage.removeItem("nexus-chats-v1");
      window.localStorage.removeItem("nexus-drafts-v1");
      window.localStorage.setItem("nexus-demo-chats-cleared-v1", "1");
      return [];
    }
    try {
      const saved = window.localStorage.getItem("nexus-chats-v1");
      return saved ? (JSON.parse(saved) as Chat[]) : [];
    } catch {
      return [];
    }
  });
  const [activeId, setActiveId] = useState(1);
  const [draft, setDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [search, setSearch] = useState("");
  const [foundUsers, setFoundUsers] = useState<UserSearchResult[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [chatFilter, setChatFilter] = useState<ChatFilter>("all");
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<number, string>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem("nexus-drafts-v1") || "{}") as Record<number, string>;
    } catch {
      return {};
    }
  });
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatName, setNewChatName] = useState("");
  const [newChatIsGroup, setNewChatIsGroup] = useState(() => !isDemoMode);
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
  const [profileAvatar, setProfileAvatar] = useState(() => window.localStorage.getItem("nexus-profile-avatar") || "N");
  const [username, setUsername] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);
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

  const activeChat: Chat = chats.find((chat) => chat.id === activeId) ?? chats[0] ?? {
    id: 0,
    name: "Новый чат",
    avatar: "＋",
    color: "blue",
    preview: "Создай чат или найди пользователя по username",
    time: "",
    messages: [],
  };
  const sortedChats = useMemo(() => sortChats(chats), [chats]);

  useEffect(() => {
    if (chats.length > 0 && !chats.some((chat) => chat.id === activeId)) setActiveId(chats[0].id);
  }, [chats, activeId]);
  const visibleMessages = useMemo(() => getVisibleMessages(activeChat.messages, messageSearch), [activeChat, messageSearch]);
  const galleryImages = useMemo(() => getGalleryImages(chats), [chats]);
  const filteredChats = useMemo(() => filterChats(chats, search), [chats, search]);
  const displayChats = useMemo(
    () =>
      sortedChats.filter(
        (chat) => matchesChatFilter(chat, chatFilter) && (!search.trim() || filteredChats.some((item) => item.id === chat.id))
      ),
    [sortedChats, chatFilter, search, filteredChats]
  );
  const unreadTotal = useMemo(() => chats.reduce((sum, chat) => sum + (chat.unread ?? 0), 0), [chats]);
  const mentionQuery = draft.match(/(?:^|\s)@([^\s@]*)$/)?.[1] ?? null;
  const mentionMatches =
    mentionQuery === null
      ? []
      : [...new Set([profileName, ...friends.map((friend) => friend.name), ...(activeChat.members ?? [])])]
          .filter((name) => name.toLocaleLowerCase("ru-RU").startsWith(mentionQuery.toLocaleLowerCase("ru-RU")))
          .slice(0, 6);

  useEffect(() => {
    if (!supabase) {
      setProfileReady(true);
      return;
    }
    let alive = true;
    const syncProfile = async () => {
      const client = supabase;
      if (!client) {
        setProfileReady(true);
        return;
      }
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (!alive) return;
      if (userError || !user) {
        setAccountId(null);
        setProfileReady(true);
        return;
      }
      setAccountId(user.id);
      const metadataName =
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : typeof user.user_metadata?.name === "string"
            ? user.user_metadata.name
            : "";
      const { data: existingProfile, error: readError } = await client
        .from("profiles")
        .select("display_name, avatar, username")
        .eq("id", user.id)
        .maybeSingle();
      if (!alive) return;
      if (readError) {
        setAccountId(null);
        setNotice("Не удалось загрузить профиль из Supabase");
        setProfileReady(true);
        return;
      }
      if (existingProfile) {
        setProfileName(existingProfile.display_name || metadataName || "Пользователь");
        setProfileAvatar(existingProfile.avatar || metadataName.slice(0, 1).toUpperCase() || "N");
        setUsername(existingProfile.username || "");
      } else {
        const displayName = metadataName.trim() || user.email?.split("@")[0] || "Пользователь";
        const avatar = displayName.slice(0, 1).toUpperCase() || "N";
        const { error: insertError } = await client.from("profiles").insert({ id: user.id, display_name: displayName, avatar });
        if (!alive) return;
        if (insertError) setNotice("Не удалось создать профиль в Supabase");
        else {
          setProfileName(displayName);
          setProfileAvatar(avatar);
        }
      }
      setProfileReady(true);
    };
    void syncProfile();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("nexus-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("nexus-profile-name", profileName);
    window.localStorage.setItem("nexus-profile-avatar", profileAvatar);
    const client = supabase;
    if (!client || !accountId || !profileReady) return;
    const saveProfile = async () => {
      const { error } = await client.from("profiles").upsert({
        id: accountId,
        display_name: profileName.trim() || "Пользователь",
        avatar: profileAvatar.trim() || "N",
        updated_at: new Date().toISOString(),
      });
      if (error) setNotice("Не удалось сохранить профиль в Supabase");
    };
    void saveProfile();
  }, [profileName, profileAvatar, accountId, profileReady]);

  async function saveUsername() {
    const client = supabase;
    const normalized = username.trim().toLowerCase();
    if (!client || !accountId) {
      action("Вход через Google необходим для сохранения username");
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
      action("Username: 3–20 символов, только латиница, цифры и _");
      return;
    }
    setUsernameSaving(true);
    const { error } = await client.from("profiles").update({ username: normalized }).eq("id", accountId);
    setUsernameSaving(false);
    if (error) {
      if (error.code === "23505") action("Этот username уже занят. Выбери другой.");
      else if (error.code === "42703" || error.message.toLowerCase().includes("username")) action("Сначала выполни SQL-миграцию username в Supabase");
      else action("Не удалось сохранить username");
      return;
    }
    setUsername(normalized);
    action("Username сохранён — по нему тебя можно будет найти");
  }

  useEffect(() => {
    window.localStorage.setItem("nexus-drafts-v1", JSON.stringify(drafts));
  }, [drafts]);

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

  useEffect(() => {
    const client = supabase;
    const query = search.trim().replace(/^@/, "").toLowerCase();
    if (!client || query.length < 3) {
      setFoundUsers([]);
      setUserSearchLoading(false);
      return;
    }
    let alive = true;
    setUserSearchLoading(true);
    const timer = window.setTimeout(async () => {
      const { data, error } = await client.from("profiles").select("id, username, display_name, avatar").ilike("username", `${query}%`).limit(8);
      if (!alive) return;
      setUserSearchLoading(false);
      if (error) {
        setFoundUsers([]);
        return;
      }
      setFoundUsers((data ?? []).filter((user) => user.id !== accountId && Boolean(user.username)) as UserSearchResult[]);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [search, accountId]);

  useEffect(() => {
    const client = supabase;
    if (!client || !accountId || !profileReady) return;
    let alive = true;
    const loadCloudChats = async () => {
      const { data: memberships, error: membershipError } = await client.from("chat_members").select("chat_id").eq("user_id", accountId);
      if (!alive) return;
      if (membershipError) {
        setNotice("Не удалось загрузить облачные чаты");
        return;
      }
      const chatIds = [...new Set((memberships ?? []).map((item) => item.chat_id as string))];
      if (chatIds.length === 0) {
        setChats([]);
        return;
      }
      const [{ data: cloudChatRows, error: chatsError }, { data: profileRows }] = await Promise.all([
        client.from("chats").select("id, title, is_group, invite_code, created_at").in("id", chatIds).order("updated_at", { ascending: false }),
        client.from("chat_members").select("chat_id, user_id").in("chat_id", chatIds),
      ]);
      if (!alive) return;
      if (chatsError) {
        setNotice("Не удалось загрузить список чатов");
        return;
      }
      const memberIds = [...new Set((profileRows ?? []).map((row) => row.user_id as string).filter((id) => id !== accountId))];
      const { data: memberProfiles } = memberIds.length
        ? await client.from("profiles").select("id, username, display_name, avatar").in("id", memberIds)
        : { data: [] as { id: string; username: string | null; display_name: string; avatar: string }[] };
      const { data: messageRows, error: messagesError } = await client
        .from("messages")
        .select("id, chat_id, sender_id, body, attachment, effect, poll, reply_to, created_at, edited_at, deleted_at")
        .in("chat_id", chatIds)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (!alive) return;
      if (messagesError) setNotice("Чаты загружены, но сообщения получить не удалось");

      const mappedChats: Chat[] = await Promise.all(
        (cloudChatRows ?? []).map(async (row) => {
          const chatMembers = (profileRows ?? []).filter((member) => member.chat_id === row.id);
          const otherId = chatMembers.find((member) => member.user_id !== accountId)?.user_id;
          const other = (memberProfiles ?? []).find((profile) => profile.id === otherId);
          const chatMessages: Message[] = await Promise.all(
            (messageRows ?? [])
              .filter((message) => message.chat_id === row.id)
              .map(async (message) => {
                const sender = message.sender_id === accountId ? profileName : other?.display_name || "Пользователь";
                const created = new Date(message.created_at);
                const { data: reactionRows } = await client.from("message_reactions").select("emoji").eq("message_id", message.id);
                const attachmentMeta = message.attachment as { name?: string; type?: string; size?: number; path?: string } | null;
                let attachment: Message["attachment"];
                if (attachmentMeta) {
                  let data = "";
                  if (attachmentMeta.path) {
                    const { data: signed } = await client.storage.from("chat-media").createSignedUrl(attachmentMeta.path, 3600);
                    data = signed?.signedUrl || "";
                  }
                  attachment = {
                    name: attachmentMeta.name || "Вложение",
                    type: attachmentMeta.type || "application/octet-stream",
                    size: attachmentMeta.size || 0,
                    data,
                    ...(attachmentMeta.path ? { path: attachmentMeta.path } : {}),
                  };
                }
                return {
                  id: numericId(message.id),
                  remoteId: message.id,
                  author: sender,
                  text: message.deleted_at ? "Сообщение удалено" : message.body,
                  time: clockTime(created),
                  mine: message.sender_id === accountId,
                  createdAt: created.getTime(),
                  edited: Boolean(message.edited_at),
                  ...(message.effect ? { effect: message.effect } : {}),
                  ...(message.poll ? { poll: message.poll as Message["poll"] } : {}),
                  ...(attachment ? { attachment } : {}),
                  reactions: (reactionRows ?? []).map((reaction) => reaction.emoji),
                };
              })
          );
          const last = chatMessages[chatMessages.length - 1];
          return {
            id: numericId(row.id),
            remoteId: row.id,
            name: row.is_group ? row.title : other?.display_name || row.title,
            avatar: row.is_group ? "👥" : other?.avatar || other?.display_name?.slice(0, 1) || "N",
            color: row.is_group ? "group" : "blue",
            preview: last?.text || "Начни общение",
            time: last?.time || "",
            messages: chatMessages,
            group: row.is_group,
            inviteCode: row.invite_code || undefined,
            members: chatMembers.map(
              (member) =>
                member.user_id === accountId
                  ? profileName
                  : (memberProfiles ?? []).find((profile) => profile.id === member.user_id)?.display_name || "Пользователь"
            ),
          };
        })
      );
      setChats(mappedChats);
      setActiveId(mappedChats[0]?.id ?? 0);
    };
    void loadCloudChats();
    return () => {
      alive = false;
    };
  }, [accountId, profileReady, profileName]);

  useEffect(() => {
    const client = supabase;
    const code = new URLSearchParams(window.location.search).get("join");
    if (!client || !accountId || !code) return;
    let cancelled = false;
    const join = async () => {
      const { error } = await client.rpc("join_group_by_invite", { invite_code_input: code });
      if (cancelled) return;
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.replaceState({}, "", url.toString());
      if (error) {
        action(error.message.includes("join_group_by_invite") ? "Примени миграцию облачных групп в Supabase" : "Ссылка недействительна или не удалось вступить в группу");
        return;
      }
      action("Ты вступил в группу");
      window.location.reload();
    };
    void join();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const activeRemoteId = chats.find((chat) => chat.id === activeId)?.remoteId;

  useEffect(() => {
    const client = supabase;
    if (!client || !accountId || !activeRemoteId) return;
    const channel = client
      .channel(`nexus-messages-${activeRemoteId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `chat_id=eq.${activeRemoteId}` }, async (payload) => {
        const row = payload.new as ChatMessageRow;
        if (!row?.id) return;
        let attachment: Message["attachment"];
        if (row.attachment) {
          let data = "";
          if (row.attachment.path) {
            const signed = await client.storage.from("chat-media").createSignedUrl(row.attachment.path, 3600);
            data = signed.data?.signedUrl || "";
          }
          attachment = {
            name: row.attachment.name || "Вложение",
            type: row.attachment.type || "application/octet-stream",
            size: row.attachment.size || 0,
            path: row.attachment.path,
            data,
          };
        }
        setChats((current) => {
          const chat = current.find((item) => item.remoteId === row.chat_id);
          if (!chat) return current;
          const existing = chat.messages.find((message) => message.remoteId === row.id);
          if (existing) {
            if (!row.poll) return current;
            return mapMessagesByRemoteId(current, row.id, (message) => ({ ...message, poll: row.poll as Message["poll"] }));
          }
          if (payload.eventType !== "INSERT" || row.sender_id === accountId) return current;
          const created = new Date(row.created_at);
          const message: Message = {
            id: numericId(row.id),
            remoteId: row.id,
            author: chat.name,
            text: row.deleted_at ? "Сообщение удалено" : row.body,
            time: clockTime(created),
            mine: false,
            createdAt: created.getTime(),
            edited: Boolean(row.edited_at),
            ...(row.effect ? { effect: row.effect } : {}),
            ...(row.poll ? { poll: row.poll as Message["poll"] } : {}),
            ...(attachment ? { attachment } : {}),
          };
          const preview = row.poll ? "📊 " + row.body : attachment ? "📎 " + row.body : message.text;
          return appendMessage(current, chat.id, message, preview, message.time);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, async (payload) => {
        const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as { message_id?: string };
        if (!row.message_id) return;
        const { data: reactions } = await client.from("message_reactions").select("emoji").eq("message_id", row.message_id);
        const emojis = (reactions ?? []).map((item) => item.emoji);
        setChats((current) => mapMessagesByRemoteId(current, row.message_id!, (message) => ({ ...message, reactions: emojis })));
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [accountId, activeRemoteId]);

  async function openDirectChat(user: UserSearchResult) {
    const client = supabase;
    if (!client || !accountId) {
      action("Войди в аккаунт, чтобы начать переписку");
      return;
    }
    const existing = chats.find((chat) => chat.members?.some((member) => member === user.display_name || member === `@${user.username}`) && !chat.group);
    if (existing) {
      setActiveId(existing.id);
      setSearch("");
      setActiveNav("Чаты");
      return;
    }
    setOpeningUserId(user.id);
    const { data, error } = await client.rpc("create_direct_chat", { target_user_id: user.id });
    setOpeningUserId(null);
    if (error || !data) {
      action(error?.message.includes("function") ? "Выполни SQL-миграцию direct_chats в Supabase" : "Не удалось создать диалог. Проверь SQL-миграцию и попробуй ещё раз.");
      return;
    }
    const remoteId = data as string;
    const localId = numericId(remoteId);
    const created: Chat = {
      id: localId,
      remoteId,
      name: user.display_name,
      avatar: user.avatar || user.display_name.slice(0, 1).toUpperCase(),
      color: "blue",
      preview: "Диалог создан — напиши первое сообщение",
      time: "",
      messages: [],
      members: [profileName, user.display_name],
    };
    setChats((current) => (current.some((chat) => chat.remoteId === remoteId) ? current : [created, ...current]));
    setActiveId(localId);
    setSearch("");
    setDraft("");
    setActiveNav("Чаты");
    action(`Диалог с @${user.username} создан`);
  }

  async function handleAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const chat = chats.find((item) => item.id === activeId);
    const client = supabase;
    if (!client || !accountId || !chat?.remoteId) {
      action("Открой облачный диалог, чтобы отправить файл");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      action("Максимальный размер файла — 50 МБ");
      return;
    }
    if (
      !file.type.startsWith("image/") &&
      !file.type.startsWith("video/") &&
      !file.type.startsWith("audio/") &&
      !["application/pdf", "text/plain", "application/zip", "text/csv"].includes(file.type)
    ) {
      action("Этот формат файла пока не поддерживается");
      return;
    }
    action("Загружаю файл…");
    const path = chat.remoteId + "/" + accountId + "/" + crypto.randomUUID() + "-" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uploaded = await client.storage.from("chat-media").upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (uploaded.error) {
      action("Не удалось загрузить файл. Выполни миграцию online_media в Supabase.");
      return;
    }
    const signed = await client.storage.from("chat-media").createSignedUrl(path, 3600);
    if (signed.error || !signed.data?.signedUrl) {
      action("Не удалось получить ссылку на файл");
      return;
    }
    const meta = { name: file.name, type: file.type || "application/octet-stream", size: file.size, path };
    const inserted = await client.from("messages").insert({ chat_id: chat.remoteId, sender_id: accountId, body: file.name, attachment: meta }).select("id, created_at").single();
    if (inserted.error || !inserted.data) {
      await client.storage.from("chat-media").remove([path]);
      action("Не удалось отправить вложение");
      return;
    }
    const row = inserted.data;
    const created = new Date(row.created_at);
    const message: Message = {
      id: numericId(row.id),
      remoteId: row.id,
      author: profileName,
      text: file.name,
      time: clockTime(created),
      mine: true,
      createdAt: created.getTime(),
      attachment: { ...meta, data: signed.data.signedUrl },
    };
    setChats((current) => appendMessage(current, activeId, message, "📎 " + file.name, message.time));
    action("Вложение отправлено");
  }

  async function createChat(event: FormEvent) {
    event.preventDefault();
    const name = newChatName.trim();
    if (!name) return;
    const wantsGroup = isDemoMode ? newChatIsGroup : true;
    if (wantsGroup) {
      if (!supabase || !accountId) {
        action("Войди в аккаунт, чтобы создать облачную группу");
        return;
      }
      const { data, error } = await supabase.rpc("create_group_chat", { group_title: name });
      const createdRow = Array.isArray(data) ? data[0] : data;
      if (error || !createdRow?.chat_id) {
        action(error?.message?.includes("create_group_chat") ? "Примени миграцию 20261028_cloud_group_chats.sql в Supabase" : "Не удалось создать облачную группу");
        return;
      }
      const created: Chat = {
        id: numericId(createdRow.chat_id),
        remoteId: createdRow.chat_id,
        name,
        avatar: "👥",
        color: "group",
        preview: "Группа создана",
        time: clockTime(),
        messages: [],
        group: true,
        members: [profileName],
        inviteCode: createdRow.invite_code,
      };
      setChats((current) => [created, ...current]);
      setActiveId(created.id);
      setDraft("");
      setNewChatName("");
      setNewChatOpen(false);
      setActiveNav("Чаты");
      action("Облачная группа создана");
      return;
    }
    const existing = chats.find((chat) => chat.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"));
    if (existing) {
      setActiveId(existing.id);
      setNewChatOpen(false);
      setNewChatName("");
      action("Этот чат уже существует");
      return;
    }
    const id = Date.now();
    const created: Chat = { id, name, avatar: name.slice(0, 1).toUpperCase(), color: "blue", preview: "Новый чат", time: clockTime(), messages: [] };
    setChats((current) => [created, ...current]);
    setActiveId(id);
    setDraft("");
    setNewChatName("");
    setNewChatOpen(false);
    setActiveNav("Чаты");
    action(`Чат «${name}» создан локально`);
  }

  function chooseMention(name: string) {
    setDraft((current) => current.replace(/(?:^|\s)@[^\s@]*$/, (match) => `${match.startsWith(" ") ? " " : ""}@${name} `));
    setMentionOpen(false);
  }

  async function createPoll(event: FormEvent) {
    event.preventDefault();
    const question = pollQuestion.trim();
    const options = pollOptions.map((text) => text.trim()).filter(Boolean);
    if (!question || options.length < 2) {
      action("Для опроса нужны вопрос и минимум два варианта");
      return;
    }
    const targetChat = chats.find((chat) => chat.id === activeId);
    const client = supabase;
    const createdAt = Date.now();
    const poll: NonNullable<Message["poll"]> = {
      question,
      options: options.map((text, index) => ({ id: `${createdAt}-${index}`, text, votes: [] })),
    };
    let remoteId: string | undefined;
    if (targetChat?.remoteId) {
      if (!client || !accountId) {
        action("Войди в аккаунт, чтобы опубликовать опрос");
        return;
      }
      const { data, error } = await client.from("messages").insert({ chat_id: targetChat.remoteId, sender_id: accountId, body: question, poll }).select("id, created_at").single();
      if (error || !data) {
        action("Опрос не сохранён. Проверь, что выполнил SQL-миграцию persistent_polls в Supabase.");
        return;
      }
      remoteId = data.id;
    } else if (client && accountId) {
      action("Этот чат локальный. Создай облачный чат, чтобы опрос синхронизировался.");
      return;
    }
    const time = clockTime();
    const message: Message = {
      id: remoteId ? numericId(remoteId) : createdAt,
      ...(remoteId ? { remoteId } : {}),
      author: profileName,
      text: question,
      time,
      mine: true,
      createdAt,
      poll,
    };
    setChats((current) => appendMessage(current, activeId, message, `📊 ${question}`, time));
    setPollOpen(false);
    setPollQuestion("");
    setPollOptions(["", ""]);
    action("Опрос создан");
  }

  async function votePoll(messageId: number, optionId: string) {
    const chat = chats.find((item) => item.id === activeId);
    const message = chat?.messages.find((item) => item.id === messageId);
    if (!message?.poll) return;
    if (chat?.remoteId && message.remoteId) {
      if (!supabase || !accountId) {
        action("Войди в аккаунт, чтобы голосовать");
        return;
      }
      const { data, error } = await supabase.rpc("vote_on_poll", { message_id_input: message.remoteId, option_id_input: optionId });
      if (error || !data) {
        action("Не удалось сохранить голос. Проверь SQL-миграцию persistent_polls.");
        return;
      }
      const poll = data as NonNullable<Message["poll"]>;
      setChats((current) => mapMessages(current, activeId, (entry) => (entry.id === messageId ? { ...entry, poll } : entry)));
      return;
    }
    setChats((current) =>
      mapMessages(current, activeId, (entry) =>
        entry.id !== messageId || !entry.poll ? entry : { ...entry, poll: toggleLocalVote(entry.poll, optionId, profileName) }
      )
    );
  }

  async function startVoiceRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      action("Запись аудио не поддерживается этим браузером");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recordingStartedRef.current = Date.now();
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) {
          action("Запись получилась пустой");
          return;
        }
        if (blob.size > 1_500_000) {
          action("Аудио больше 1,5 МБ. Попробуй записать короче");
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const data = typeof reader.result === "string" ? reader.result : "";
          if (!data) return;
          const time = clockTime();
          const createdAt = Date.now();
          const duration = Math.max(1, Math.round((Date.now() - recordingStartedRef.current) / 1000));
          const message: Message = {
            id: createdAt,
            author: profileName,
            text: `Голосовое сообщение · ${duration} сек.`,
            time,
            mine: true,
            createdAt,
            attachment: { name: `voice-${createdAt}.webm`, type: blob.type || "audio/webm", data, size: blob.size },
          };
          setChats((current) => appendMessage(current, activeId, message, "🎤 Голосовое сообщение", time));
          setRecordingSeconds(0);
          action("Голосовое сообщение добавлено в чат");
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      setRecording(true);
      setRecordingSeconds(0);
      const startedAt = Date.now();
      const tick = window.setInterval(() => {
        if (mediaRecorderRef.current?.state !== "recording") {
          window.clearInterval(tick);
          return;
        }
        setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, 500);
    } catch {
      action("Нет доступа к микрофону. Разреши запись аудио в браузере");
    }
  }

  async function createInviteLink() {
    if (!activeChat.group) {
      action("Приглашения доступны для групповых чатов");
      return;
    }
    if (!activeChat.remoteId || !activeChat.inviteCode) {
      action("Для этой группы нет облачной ссылки. Создай облачную группу заново.");
      return;
    }
    const link = `${window.location.origin}${window.location.pathname}?join=${activeChat.inviteCode}`;
    try {
      await navigator.clipboard.writeText(link);
      action("Ссылка-приглашение скопирована");
    } catch {
      action(`Ссылка: ${link}`);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (editingMessageId !== null) {
      const text = editDraft.trim();
      if (!text) return;
      const editingChat = chats.find((chat) => chat.id === activeId);
      const editingMessage = editingChat?.messages.find((message) => message.id === editingMessageId);
      if (editingChat?.remoteId && editingMessage?.remoteId) {
        if (!supabase) {
          action("Нет подключения к Supabase");
          return;
        }
        const { error } = await supabase
          .from("messages")
          .update({ body: text, edited_at: new Date().toISOString() })
          .eq("id", editingMessage.remoteId)
          .eq("sender_id", accountId);
        if (error) {
          action("Не удалось изменить сообщение в облаке");
          return;
        }
      }
      setChats((current) =>
        updateChat(current, activeId, (chat) => ({
          ...chat,
          preview: chat.messages[chat.messages.length - 1]?.id === editingMessageId ? text : chat.preview,
          messages: chat.messages.map((message) => (message.id === editingMessageId ? { ...message, text, edited: true } : message)),
        }))
      );
      setEditingMessageId(null);
      setEditDraft("");
      return;
    }
    const text = draft.trim();
    if (!text) return;
    const createdAt = Date.now();
    const time = clockTime();
    const replyTo = replyTarget ? { author: replyTarget.author, text: replyTarget.text } : undefined;
    const targetChat = chats.find((chat) => chat.id === activeId);
    const client = supabase;
    let remoteMessageId: string | undefined;
    if (targetChat?.remoteId) {
      if (!client || !accountId) {
        action("Нужно войти в аккаунт, чтобы отправить сообщение");
        return;
      }
      const { data, error } = await client.from("messages").insert({ chat_id: targetChat.remoteId, sender_id: accountId, body: text }).select("id, created_at").single();
      if (error || !data) {
        action("Сообщение не отправлено. Проверь подключение и права Supabase.");
        return;
      }
      remoteMessageId = data.id;
    } else if (client && accountId) {
      action("Этот чат локальный. Начни переписку, выбрав пользователя по @username.");
      return;
    }
    const message: Message = {
      id: remoteMessageId ? numericId(remoteMessageId) : createdAt,
      ...(remoteMessageId ? { remoteId: remoteMessageId } : {}),
      author: profileName,
      text,
      time,
      mine: true,
      createdAt,
      ...(replyTo ? { replyTo } : {}),
    };
    setChats((current) => appendMessage(current, activeId, message));
    setDraft("");
    setDrafts((current) => ({ ...current, [activeId]: "" }));
    setReplyTarget(null);
  }

  function startEditing(message: Message) {
    setEditingMessageId(message.id);
    setEditDraft(message.text);
    setDraft("");
  }

  async function applyMessageEffect(messageId: number, effect: MessageEffect) {
    const chat = chats.find((item) => item.id === activeId);
    const message = chat?.messages.find((item) => item.id === messageId);
    if (chat?.remoteId && message?.remoteId) {
      if (!supabase) return;
      const { error } = await supabase
        .from("messages")
        .update({ effect: message.effect === effect ? null : effect })
        .eq("id", message.remoteId)
        .eq("sender_id", accountId);
      if (error) {
        action("Не удалось сохранить эффект в облаке");
        return;
      }
    }
    setChats((current) =>
      mapMessages(current, activeId, (entry) =>
        entry.id !== messageId ? entry : { ...entry, effect: entry.effect === effect ? undefined : effect }
      )
    );
    setOpenMessageActionsId(null);
    action("Эффект сообщения обновлён");
  }

  async function toggleReaction(messageId: number, emoji: string) {
    const chat = chats.find((item) => item.id === activeId);
    const message = chat?.messages.find((item) => item.id === messageId);
    const client = supabase;
    if (!chat || !message || !chat.remoteId || !message.remoteId || !client || !accountId) {
      action("Реакции доступны в облачных сообщениях");
      return;
    }
    const { data: existing, error: readError } = await client
      .from("message_reactions")
      .select("emoji")
      .eq("message_id", message.remoteId)
      .eq("user_id", accountId)
      .eq("emoji", emoji)
      .maybeSingle();
    if (readError) {
      action("Не удалось проверить реакцию");
      return;
    }
    const result = existing
      ? await client.from("message_reactions").delete().eq("message_id", message.remoteId).eq("user_id", accountId).eq("emoji", emoji)
      : await client.from("message_reactions").insert({ message_id: message.remoteId, user_id: accountId, emoji });
    if (result.error) {
      action("Не удалось сохранить реакцию в облаке");
      return;
    }
    const { data: rows, error } = await client.from("message_reactions").select("emoji").eq("message_id", message.remoteId);
    if (error) {
      action("Реакция сохранена, но список не обновился");
      return;
    }
    const emojis = (rows ?? []).map((row) => row.emoji);
    setChats((current) => mapMessages(current, activeId, (entry) => (entry.id === messageId ? { ...entry, reactions: emojis } : entry)));
    setOpenMessageActionsId(null);
  }

  function openGame(name: string) {
    setActiveGame(name);
    setGameNotice("");
    if (name === "Шахматы") setChessSolved(false);
    if (name === "Uno") {
      setUnoHand(["🔴 3", "🔵 7", "🟡 2", "🟢 5", "🔴 9"]);
      setUnoTop("🔵 4");
    }
    if (name === "Балда") {
      setBaldaInput("");
      setBaldaWords([]);
      setBaldaScore(0);
    }
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
    if (word.length < 3 || !/^[а-я]+$/.test(word)) {
      setGameNotice("Введи русское слово минимум из 3 букв.");
      return;
    }
    if (baldaWords.includes(word)) {
      setGameNotice("Это слово уже использовано.");
      return;
    }
    setBaldaWords((words) => [...words, word]);
    setBaldaScore((score) => score + word.length);
    setBaldaInput("");
    setGameNotice(`Принято: +${word.length} очков!`);
  }

  function selectChat(chat: Chat) {
    setActiveId(chat.id);
    setDraft(drafts[chat.id] ?? "");
    setMessageSearch("");
    setChats((current) => markRead(current, chat.id));
  }

  function toggleChatPin(chat: Chat) {
    setChats((current) => togglePinned(current, chat.id));
    action(chat.pinned ? "Чат откреплён" : "Чат закреплён");
  }

  async function deleteMessage(messageId: number) {
    const chat = chats.find((item) => item.id === activeId);
    const index = chat?.messages.findIndex((message) => message.id === messageId) ?? -1;
    const message = index >= 0 ? chat?.messages[index] : undefined;
    if (!chat || !message) return;
    if (chat.remoteId && message.remoteId && supabase) {
      const { error } = await supabase
        .from("messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", message.remoteId)
        .eq("sender_id", accountId);
      if (error) {
        action("Не удалось удалить сообщение в облаке");
        return;
      }
    }
    setDeletedMessage({ chatId: activeId, message, index });
    setChats((current) => removeMessage(current, activeId, messageId).chats);
    setOpenMessageActionsId(null);
    if (editingMessageId === messageId) {
      setEditingMessageId(null);
      setEditDraft("");
    }
  }

  function undoDelete() {
    if (!deletedMessage) return;
    setChats((current) => restoreMessage(current, deletedMessage));
    setDeletedMessage(null);
  }

  function clearHistory() {
    if (!activeChat.messages.length) {
      action("История уже пуста");
      return;
    }
    if (!window.confirm(`Удалить всю историю чата «${activeChat.name}» на этом устройстве?`)) return;
    setChats((current) => updateChat(current, activeId, (chat) => ({ ...chat, messages: [], preview: "История очищена", time: "" })));
    setDeletedMessage(null);
    action("История чата очищена");
  }

  function changeDraft(value: string) {
    if (editingMessageId !== null) {
      setEditDraft(value);
      return;
    }
    setDraft(value);
    setDrafts((current) => ({ ...current, [activeId]: value }));
    setMentionOpen(value.includes("@"));
  }

  function addEmoji() {
    if (editingMessageId !== null) setEditDraft((value) => value + " 🙂");
    else setDraft((value) => value + " 🙂");
  }

  function copyMessage(message: Message) {
    navigator.clipboard
      ?.writeText(message.text)
      .then(() => action("Текст скопирован"))
      .catch(() => action("Не удалось скопировать текст"));
    setOpenMessageActionsId(null);
  }

  function replyToMessage(message: Message) {
    setReplyTarget(message);
    setOpenMessageActionsId(null);
  }

  function action(label: string) {
    setNotice(label);
    window.setTimeout(() => setNotice(""), 2600);
  }

  return (
    <main className="app-shell">
      <Rail
        activeNav={activeNav}
        profileName={profileName}
        profileAvatar={profileAvatar}
        unreadTotal={unreadTotal}
        onNavigate={(label) => {
          setActiveNav(label);
          if (label === "Звонки") action("Звонки подключим на следующем этапе");
          if (label === "Видео") action("Видеозвонки подключим на следующем этапе");
        }}
        onOpenSettings={() => {
          setActiveNav("Настройки");
          setProfileOpen(true);
        }}
        onOpenGames={() => {
          setActiveNav("Мини-игры");
          openGame("Каталог");
        }}
        onOpenProfile={() => setProfileOpen(true)}
      />

      <ChatListPanel
        search={search}
        onSearchChange={setSearch}
        onNewChat={() => setNewChatOpen(true)}
        userSearch={{ loading: userSearchLoading, items: foundUsers, openingUserId }}
        onOpenDirectChat={(user) => void openDirectChat(user)}
        filter={chatFilter}
        onFilterChange={setChatFilter}
        chats={displayChats}
        hasVisibleChats={displayChats.length > 0}
        activeId={activeId}
        onSelectChat={selectChat}
        onTogglePin={toggleChatPin}
      />

      <ConversationPanel
        chat={activeChat}
        isDemoMode={isDemoMode}
        accountId={accountId}
        profileName={profileName}
        searchOpen={messageSearchOpen}
        searchValue={messageSearch}
        onToggleSearch={() => setMessageSearchOpen((open) => !open)}
        onSearchChange={setMessageSearch}
        onCloseSearch={() => {
          setMessageSearchOpen(false);
          setMessageSearch("");
        }}
        onCall={() => action("Голосовые звонки подключим позже")}
        onVideo={() => action("Видеозвонки подключим позже")}
        onTogglePin={() => toggleChatPin(activeChat)}
        onToggleProfile={() => setShowProfile((open) => !open)}
        visibleMessages={visibleMessages}
        actionsOpenId={openMessageActionsId}
        onToggleActions={(messageId) => setOpenMessageActionsId((current) => (current === messageId ? null : messageId))}
        onVote={(messageId, optionId) => void votePoll(messageId, optionId)}
        onToggleReaction={(messageId, emoji) => void toggleReaction(messageId, emoji)}
        onReply={replyToMessage}
        onCopy={copyMessage}
        onEffect={(messageId, effect) => void applyMessageEffect(messageId, effect)}
        onEdit={(message) => {
          startEditing(message);
          setOpenMessageActionsId(null);
        }}
        onDelete={(messageId) => void deleteMessage(messageId)}
        onGameInvite={() => action("Приглашение в игру скоро появится")}
        endRef={messagesEndRef}
        composer={{
          draft,
          editDraft,
          editing: editingMessageId !== null,
          replyTarget,
          mentionOpen,
          mentionMatches,
          recording,
          recordingSeconds,
          fileInputRef,
          onChangeText: changeDraft,
          onEmoji: addEmoji,
          onToggleVoice: () => void startVoiceRecording(),
          onSubmit: sendMessage,
          onCancelEdit: () => {
            setEditingMessageId(null);
            setEditDraft("");
          },
          onCancelReply: () => setReplyTarget(null),
          onChooseMention: chooseMention,
          onAttachment: (event) => void handleAttachment(event),
          onOpenGallery: () => setGalleryOpen(true),
          onOpenPoll: () => setPollOpen(true),
        }}
      />

      {showProfile && (
        <RightPanel
          profileName={profileName}
          profileAvatar={profileAvatar}
          chat={activeChat}
          onClose={() => setShowProfile(false)}
          onOpenProfile={() => setProfileOpen(true)}
          onCreateInvite={() => void createInviteLink()}
          onClearHistory={clearHistory}
          onOpenGames={() => {
            setActiveNav("Мини-игры");
            openGame("Каталог");
          }}
          onOpenGame={openGame}
        />
      )}

      {activeGame && (
        <GameModal
          activeGame={activeGame}
          gameNotice={gameNotice}
          chessSolved={chessSolved}
          unoHand={unoHand}
          unoTop={unoTop}
          baldaInput={baldaInput}
          baldaWords={baldaWords}
          baldaScore={baldaScore}
          onClose={() => setActiveGame(null)}
          onOpenGame={openGame}
          onPlayUno={playUnoCard}
          onDrawUno={drawUnoCard}
          onChessAnswer={(answer) => {
            if (!answer) {
              setChessSolved(false);
              setGameNotice("");
              return;
            }
            setChessSolved(true);
            setGameNotice(answer === "Шах" ? "Верно! ♟️ Король под атакой." : "Не совсем. Правильный ответ — «Шах».");
          }}
          onBaldaInput={setBaldaInput}
          onBaldaSubmit={submitBaldaWord}
        />
      )}

      <NewChatModal
        open={newChatOpen}
        groupOnly={!isDemoMode}
        name={newChatName}
        isGroup={newChatIsGroup}
        onNameChange={setNewChatName}
        onIsGroupChange={setNewChatIsGroup}
        onClose={() => setNewChatOpen(false)}
        onSubmit={createChat}
      />

      <PollModal
        open={pollOpen}
        question={pollQuestion}
        options={pollOptions}
        onClose={() => setPollOpen(false)}
        onSubmit={createPoll}
        onQuestionChange={setPollQuestion}
        onOptionChange={(index, value) => setPollOptions((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)))}
        onAddOption={() => setPollOptions((current) => [...current, ""])}
      />

      <GalleryModal
        open={galleryOpen}
        images={galleryImages}
        onClose={() => setGalleryOpen(false)}
        onOpenImage={(image) => {
          setActiveId(chats.find((chat) => chat.name === image.chatName)?.id ?? activeId);
          setGalleryOpen(false);
        }}
      />

      <ProfileModal
        open={profileOpen}
        name={profileName}
        avatar={profileAvatar}
        username={username}
        usernameSaving={usernameSaving}
        theme={theme}
        onClose={() => setProfileOpen(false)}
        onNameChange={setProfileName}
        onAvatarChange={setProfileAvatar}
        onUsernameChange={setUsername}
        onSaveUsername={() => void saveUsername()}
        onThemeChange={setTheme}
        onDone={() => {
          setProfileOpen(false);
          action("Профиль и тема сохранены");
        }}
      />

      {deletedMessage && (
        <div className="toast undo-toast">
          <span>Сообщение удалено</span>
          <button className="undo-button" onClick={undoDelete}>
            Отменить
          </button>
          <button onClick={() => setDeletedMessage(null)} aria-label="Закрыть">
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast">
          <Shield size={17} />
          {notice}
          <button onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <button className="mobile-profile-toggle" onClick={() => setShowProfile((open) => !open)} aria-label="Профиль">
        <CircleUserRound />
      </button>
    </main>
  );
}
