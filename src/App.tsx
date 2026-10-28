import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { CircleUserRound, Shield, X } from "lucide-react";
import { supabase } from "./lib/supabase";
import Rail from "./components/Rail";
import ChatListPanel from "./components/ChatListPanel";
import ConversationPanel from "./components/ConversationPanel";
import RightPanel from "./components/RightPanel";
import GameModal from "./components/GameModal";
import { useChatMembers } from "./hooks/useChatMembers";
import { useServerSearch } from "./hooks/useServerSearch";
import { removeMember, rotateInvite, setMemberRole } from "./lib/groupAdmin";
import { createFavouritesChat, favouriteMessage, formatForwardText, isFavouritesChat, nextLocalId } from "./lib/messageActions";
import { GalleryModal, NewChatModal, PollModal, ProfileModal } from "./components/Modals";
import { friends, isDemoMode } from "./lib/constants";
import { clockTime, numericId } from "./lib/format";
import { appendMessage, applyReadStamp, mapMessages, markRead, removeMessage, restoreMessage, updateChat } from "./lib/chats";
import { toggleLocalVote } from "./lib/polls";
import { useNotice } from "./hooks/useNotice";
import { useTheme } from "./hooks/useTheme";
import { useProfile } from "./hooks/useProfile";
import { useGames } from "./hooks/useGames";
import { useChatCollection } from "./hooks/useChatCollection";
import { useUserSearch } from "./hooks/useUserSearch";
import { useCloudChats } from "./hooks/useCloudChats";
import { useRealtimeChat } from "./hooks/useRealtimeChat";
import { useHistoryPagination, useInfiniteHistory } from "./hooks/useHistoryPagination";
import { useUnreadBadge, useMessageNotifications, usePushSubscriptionSync, useNotificationsPrompt, requestNotificationPermission } from "./hooks/useNotifications";
import { subscribeToPush } from "./lib/push";
import { useAutoScroll } from "./hooks/useAutoScroll";
import { useTyping } from "./hooks/useTyping";
import { usePresence } from "./hooks/usePresence";
import type { Chat, ChatFilter, Message, MessageEffect, UserSearchResult } from "./types";

export default function App() {
  const [search, setSearch] = useState("");
  const [chatFilter, setChatFilter] = useState<ChatFilter>("all");
  const [messageSearch, setMessageSearch] = useState("");
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
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
  const [showProfile, setShowProfile] = useState(true);
  const [membersRefreshKey, setMembersRefreshKey] = useState(0);
  const [pinnedMessageIds, setPinnedMessageIds] = useState<Set<number>>(() => new Set());
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);
  const [openMessageActionsId, setOpenMessageActionsId] = useState<number | null>(null);
  const [deletedMessage, setDeletedMessage] = useState<{ chatId: number; message: Message; index: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesAreaRef = useRef<HTMLDivElement | null>(null);

  const { notice, notify: action, clearNotice } = useNotice();
  const { theme, setTheme } = useTheme();
  const {
    profileName,
    setProfileName,
    profileAvatar,
    setProfileAvatar,
    username,
    setUsername,
    usernameSaving,
    accountId,
    profileReady,
    saveUsername,
  } = useProfile({ notify: action });
  const {
    activeGame,
    setActiveGame,
    gameNotice,
    chessSolved,
    unoHand,
    unoTop,
    baldaInput,
    baldaWords,
    baldaScore,
    setBaldaInput,
    openGame,
    playUnoCard,
    drawUnoCard,
    submitBaldaWord,
    answerChess,
  } = useGames();
  const { chats, setChats, activeId, setActiveId, drafts, setDrafts, activeChat, displayChats, visibleMessages, galleryImages, unreadTotal, toggleChatPin } =
    useChatCollection({ search, chatFilter, messageSearch, notify: action });
  const { foundUsers, userSearchLoading } = useUserSearch({ search, accountId });

  useCloudChats({ accountId, profileReady, profileName, notify: action, setChats, setActiveId });
  useRealtimeChat({ accountId, profileName, remoteId: activeChat.remoteId, setChats });
  useAutoScroll(messagesEndRef, [activeId, activeChat.messages.length]);

  const { loadOlder, loadingChatIds } = useHistoryPagination({ accountId, profileName, notify: action, setChats });
  useInfiniteHistory(messagesAreaRef, activeChat, loadOlder);
  useUnreadBadge(unreadTotal);
  useMessageNotifications({ accountId, chats });
  // Re-register the push subscription on every sign-in: a cleared cache, a fresh
  // PWA install or a rotated endpoint would otherwise leave the user silently
  // unsubscribed until they pressed the bell again.
  usePushSubscriptionSync(accountId);
  // Offer notifications once, on the first interaction after the app is ready.
  useNotificationsPrompt({ accountId, enabled: profileReady, onNotice: action });

  const { members: chatMembers, reload: reloadMembers } = useChatMembers({
    chatId: activeChat.remoteId ?? null,
    isGroup: Boolean(activeChat.group),
    refreshKey: membersRefreshKey,
  });
  const myChatRole = accountId ? chatMembers.find((member) => member.user_id === accountId)?.role ?? null : null;

  // Full-history search: the local filter only sees already-downloaded pages.
  const serverSearch = useServerSearch({
    chatId: activeChat.remoteId ?? null,
    query: messageSearch,
    enabled: messageSearchOpen && Boolean(activeChat.remoteId),
  });

  const { typingUsers, notifyTyping } = useTyping({ remoteId: activeChat.remoteId, accountId, profileName });
  const { onlineIds } = usePresence({ accountId, profileName });
  const peerId =
    activeChat.group || !activeChat.remoteId
      ? null
      : Object.keys(activeChat.memberReadAt ?? {}).find((id) => id !== accountId) ?? null;
  const peerOnline = Boolean(peerId && onlineIds.includes(peerId));
  const peerLastSeenAt = peerId ? activeChat.memberLastSeenAt?.[peerId] || null : null;

  const mentionQuery = draft.match(/(?:^|\s)@([^\s@]*)$/)?.[1] ?? null;
  const mentionMatches =
    mentionQuery === null
      ? []
      : [...new Set([profileName, ...friends.map((friend) => friend.name), ...(activeChat.members ?? [])])]
          .filter((name) => name.toLocaleLowerCase("ru-RU").startsWith(mentionQuery.toLocaleLowerCase("ru-RU")))
          .slice(0, 6);

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

  /** Issues a new invite code, which immediately invalidates the previous link. */
  async function rotateInviteLink() {
    const client = supabase;
    if (!client || !activeChat.remoteId) {
      action("Обновление ссылки доступно только для облачных групп");
      return;
    }
    const result = await rotateInvite(client, activeChat.remoteId);
    if (!result.ok) {
      action(result.message);
      return;
    }
    setChats((current) =>
      current.map((chat) => (chat.id === activeId ? { ...chat, inviteCode: result.data } : chat))
    );
    const link = `${window.location.origin}${window.location.pathname}?join=${result.data}`;
    try {
      await navigator.clipboard.writeText(link);
      action("Новая ссылка-приглашение создана и скопирована");
    } catch {
      action(`Новая ссылка: ${link}`);
    }
  }

  async function changeMemberRole(userId: string, role: "admin" | "member") {
    const client = supabase;
    if (!client || !activeChat.remoteId) return;
    const result = await setMemberRole(client, activeChat.remoteId, userId, role);
    if (!result.ok) {
      action(result.message);
      return;
    }
    action(role === "admin" ? "Участник назначен администратором" : "Администратор снят");
    setMembersRefreshKey((key) => key + 1);
  }

  async function kickMember(userId: string) {
    const client = supabase;
    if (!client || !activeChat.remoteId) return;
    const result = await removeMember(client, activeChat.remoteId, userId);
    if (!result.ok) {
      action(result.message);
      return;
    }
    action("Участник удалён из группы");
    setMembersRefreshKey((key) => key + 1);
  }

  async function leaveGroup() {
    const client = supabase;
    if (!client || !activeChat.remoteId || !accountId) return;
    const result = await removeMember(client, activeChat.remoteId, accountId);
    if (!result.ok) {
      action(result.message);
      return;
    }
    action("Ты покинул группу");
    setChats((current) => current.filter((chat) => chat.id !== activeId));
  }

  function searchAuthor(userId: string): string {
    const member = chatMembers.find((item) => item.user_id === userId);
    if (member?.display_name) return member.display_name;
    if (userId === accountId) return profileName;
    return chatMembers.some((item) => item.user_id === userId) ? "Участник" : activeChat.name;
  }

  function searchTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  /**
   * A hit may live further back than the loaded page, so pages are pulled in
   * until the message is on screen or history runs out.
   */
  async function openSearchHit(hitCreatedAt: string) {
    const target = new Date(hitCreatedAt).getTime();
    if (Number.isNaN(target)) return;
    setMessageSearchOpen(false);
    setMessageSearch("");

    const current = chats.find((chat) => chat.id === activeId);
    if (!current?.remoteId) return;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const oldest = current.messages.reduce(
        (min, message) => Math.min(min, message.createdAt ?? Number.POSITIVE_INFINITY),
        Number.POSITIVE_INFINITY
      );
      if (oldest <= target || current.historyExhausted) break;
      await loadOlder(current);
      const updated = chats.find((chat) => chat.id === activeId) ?? current;
      if (updated.messages.length === current.messages.length) break;
      if (updated.historyExhausted) break;
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

  async function selectChat(chat: Chat) {
    setActiveId(chat.id);
    setDraft(drafts[chat.id] ?? "");
    setMessageSearch("");
    setChats((current) => markRead(current, chat.id));
    const client = supabase;
    if (!client || !accountId || !chat.remoteId) return;
    const { data, error } = await client.rpc("mark_chat_read", { target_chat_id: chat.remoteId });
    if (error || typeof data !== "string") return;
    const stamped = Date.parse(data);
    if (Number.isNaN(stamped)) return;
    setChats((current) => applyReadStamp(current, chat.id, accountId, stamped));
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
    if (value) notifyTyping();
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

  /** Sends the message into the open chat with a marker naming the original author. */
  async function forwardMessage(message: Message) {
    setOpenMessageActionsId(null);
    const text = formatForwardText(message);
    const chat = chats.find((item) => item.id === activeId);
    if (!chat) return;
    if (chat.remoteId) {
      const client = supabase;
      if (!client || !accountId) {
        action("Нет подключения к Supabase");
        return;
      }
      const { data, error } = await client
        .from("messages")
        .insert({ chat_id: chat.remoteId, sender_id: accountId, body: text })
        .select("id")
        .single();
      if (error) {
        action("Не удалось переслать сообщение");
        return;
      }
      setChats((current) =>
        current.map((item) =>
          item.id === chat.id
            ? {
                ...item,
                messages: [
                  ...item.messages,
                  {
                    id: nextLocalId(item.messages),
                    remoteId: data.id as string,
                    author: profileName,
                    text,
                    time: clockTime(new Date()),
                    mine: true,
                    createdAt: Date.now(),
                  },
                ],
                preview: text.split("\n").pop() ?? text,
                time: clockTime(new Date()),
              }
            : item
        )
      );
      action("Сообщение переслано");
      return;
    }
    // Local-only chat: the message never leaves this browser.
    setChats((current) =>
      current.map((item) =>
        item.id === chat.id
          ? {
              ...item,
              messages: [
                ...item.messages,
                {
                  id: nextLocalId(item.messages),
                  author: profileName,
                  text,
                  time: clockTime(new Date()),
                  mine: true,
                  createdAt: Date.now(),
                },
              ],
              preview: text.split("\n").pop() ?? text,
              time: clockTime(new Date()),
            }
          : item
      )
    );
    action("Сообщение переслано");
  }

  /** Keeps a private copy in the "Избранное" chat, which never syncs. */
  function saveToFavourites(message: Message) {
    setOpenMessageActionsId(null);
    const content = message.text.trim() || message.attachment?.name || "Вложение";
    setChats((current) => {
      const existing = current.find(isFavouritesChat);
      const base = existing ?? createFavouritesChat();
      const saved = favouriteMessage({ ...message, text: content }, nextLocalId(base.messages));
      const updated = {
        ...base,
        messages: [...base.messages, saved],
        preview: content,
        time: clockTime(new Date()),
      };
      return existing ? current.map((item) => (isFavouritesChat(item) ? updated : item)) : [updated, ...current];
    });
    action("Сохранено в избранное");
  }

  /** Pins or unpins a message; groups restrict this to admins on the server. */
  async function togglePinnedMessage(message: Message) {
    setOpenMessageActionsId(null);
    const chat = chats.find((item) => item.id === activeId);
    if (!chat) return;
    const nowPinned = !pinnedMessageIds.has(message.id);

    if (chat.remoteId && message.remoteId) {
      const client = supabase;
      if (!client) {
        action("Нет подключения к Supabase");
        return;
      }
      const { error } = await client.rpc("set_message_pin", {
        target_message_id: message.remoteId,
        pinned: nowPinned,
      });
      if (error) {
        action(
          /42501|Only admins/i.test(error.message)
            ? "В группе закреплять сообщения могут только администраторы"
            : "Не удалось изменить закрепление"
        );
        return;
      }
    }
    setPinnedMessageIds((current) => {
      const next = new Set(current);
      if (nowPinned) next.add(message.id);
      else next.delete(message.id);
      return next;
    });
    setChats((current) =>
      current.map((item) =>
        item.id === chat.id
          ? {
              ...item,
              messages: item.messages.map((entry) =>
                entry.id === message.id ? { ...entry, pinned: nowPinned } : entry
              ),
            }
          : item
      )
    );
    action(nowPinned ? "Сообщение закреплено" : "Сообщение откреплено");
  }

  async function toggleNotifications() {
    const permission = await requestNotificationPermission();
    if (permission === "denied") {
      action("Уведомления запрещены в настройках браузера");
      return;
    }
    if (permission === "unsupported") {
      action("Браузер не поддерживает уведомления");
      return;
    }
    if (permission !== "granted") {
      action("Разреши уведомления, чтобы получать их в фоне");
      return;
    }
    if (!accountId) return;
    const push = await subscribeToPush(accountId);
    if (push === "subscribed") action("Уведомления включены, в том числе в фоне");
    else if (push === "not-configured") action("Локальные уведомления включены. Для фоновых нужен VAPID-ключ");
    else if (push === "unsupported") action("Браузер не поддерживает фоновые уведомления");
    else if (push === "push-service") action("Push-служба браузера недоступна: перезапусти браузер или проверь VPN");
    else if (push === "error") action("Не удалось включить фоновые уведомления");
    else action("Локальные уведомления включены");
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
        onToggleNotifications={() => void toggleNotifications()}
        notificationsGranted={typeof Notification !== "undefined" && Notification.permission === "granted"}
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
        searchHits={serverSearch}
        searchAuthor={searchAuthor}
        searchTime={searchTime}
        onOpenSearchHit={(createdAt) => void openSearchHit(createdAt)}
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
        onForward={(message) => void forwardMessage(message)}
        onFavourite={saveToFavourites}
        onTogglePinMessage={(message) => void togglePinnedMessage(message)}
        pinnedMessageIds={pinnedMessageIds}
        onEffect={(messageId, effect) => void applyMessageEffect(messageId, effect)}
        onEdit={(message) => {
          startEditing(message);
          setOpenMessageActionsId(null);
        }}
        onDelete={(messageId) => void deleteMessage(messageId)}
        onGameInvite={() => action("Приглашение в игру скоро появится")}
        typingNames={typingUsers.map((user) => user.name)}
        peerOnline={peerOnline}
        peerLastSeenAt={peerLastSeenAt}
        endRef={messagesEndRef}
        messagesRef={messagesAreaRef}
        loadingHistory={Boolean(activeChat.remoteId && loadingChatIds.includes(activeChat.remoteId))}
        historyExhausted={Boolean(activeChat.historyExhausted)}
        onLoadOlder={() => void loadOlder(activeChat)}
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
          members={chatMembers}
          myRole={myChatRole}
          onClose={() => setShowProfile(false)}
          onOpenProfile={() => setProfileOpen(true)}
          onCreateInvite={() => void createInviteLink()}
          onRotateInvite={() => void rotateInviteLink()}
          onChangeRole={(userId, role) => void changeMemberRole(userId, role)}
          onRemoveMember={(userId) => void kickMember(userId)}
          onLeaveGroup={() => void leaveGroup()}
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
          onChessAnswer={answerChess}
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
          <button onClick={clearNotice}>
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
