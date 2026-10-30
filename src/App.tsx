import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Shield, X } from "lucide-react";
import { supabase } from "./lib/supabase";
import Rail from "./components/Rail";
import ChatListPanel from "./components/ChatListPanel";
import ConversationPanel from "./components/ConversationPanel";
import RightPanel from "./components/RightPanel";
import GameModal from "./components/GameModal";
import { useChatMembers } from "./hooks/useChatMembers";
import { useServerSearch } from "./hooks/useServerSearch";
import PrivacyModal from "./components/PrivacyModal";
import SettingsModal from "./components/SettingsModal";
import { CallOverlay } from "./components/CallOverlay";
import { useCalls } from "./hooks/useCalls";
import { describeCallError } from "./lib/calls";
import {
  DEFAULT_PRIVACY,
  blockUser,
  deleteAccount,
  fetchBlockedIds,
  fetchPrivacyPreferences,
  savePrivacyPreferences,
  unblockUser,
} from "./lib/privacy";
import type { PrivacyPreferences } from "./lib/privacy";
import { removeMember, rotateInvite, setMemberRole } from "./lib/groupAdmin";
import { CACHE_KEYS, mediaBytes, presentCacheKeys } from "./lib/storageUsage";
import { SESSION_STORAGE_KEY, type SessionRecord, describeDevice, upsertSession } from "./lib/sessions";
import {
  DEFAULT_VISIBILITY,
  type VisibilitySettings,
  describeVisibility,
  parseVisibility,
} from "./lib/visibility";
import { createFavouritesChat, favouriteMessage, formatForwardText, isFavouritesChat, nextLocalId } from "./lib/messageActions";
import { MAX_UPLOAD_BYTES, blobToDataUrl, buildStoragePath, formatBytes, isSupportedFile, prepareImage, shouldCompress } from "./lib/media";
import { analyseWaveform } from "./lib/voice";
import { GalleryModal, MuteModal, NewChatModal, PollModal } from "./components/Modals";
import { friends, isDemoMode } from "./lib/constants";
import { clockTime, numericId } from "./lib/format";
import { appendMessage, applyReadStamp, mapMessages, markRead, removeMessage, restoreMessage, updateChat } from "./lib/chats";
import { placeNewMessage } from "./lib/messageOrder";
import { isTransientError, withRetry } from "./lib/retry";
import { toggleLocalVote } from "./lib/polls";
import { useNotice } from "./hooks/useNotice";
import { useTheme } from "./hooks/useTheme";
import { useProfile } from "./hooks/useProfile";
import { useAvatar } from "./hooks/useAvatar";
import { useGames } from "./hooks/useGames";
import { useChatCollection } from "./hooks/useChatCollection";
import { useUserSearch } from "./hooks/useUserSearch";
import { useCloudChats } from "./hooks/useCloudChats";
import { useRealtimeChat } from "./hooks/useRealtimeChat";
import { useAttachmentRefresh } from "./hooks/useAttachmentRefresh";
import { SIGNED_URL_TTL_SECONDS } from "./lib/messageSync";
import { loadMessagePage } from "./lib/messageLoader";
import { useHistoryPagination, useInfiniteHistory } from "./hooks/useHistoryPagination";
import { useUnreadBadge, useMessageNotifications, usePushSubscriptionSync, useNotificationsPrompt, requestNotificationPermission } from "./hooks/useNotifications";
import { useNotificationPrefs } from "./hooks/useNotificationPrefs";
import { useLanguage } from "./hooks/useLanguage";
import { usePasscode } from "./hooks/usePasscode";
import { useTwoFactor } from "./hooks/useTwoFactor";
import { useWallpaper } from "./hooks/useWallpaper";
import { useMediaPolicy } from "./hooks/useMediaPolicy";
import { useShortcuts } from "./hooks/useShortcuts";
import { useBackSwipe } from "./hooks/useBackSwipe";
import ShortcutHelp from "./components/ShortcutHelp";
import type { Shortcut } from "./lib/shortcuts";
import { exportAsText, exportFileName, pluralMessages } from "./lib/exportChat";
import { useChatFolders } from "./hooks/useChatFolders";
import { chatsInFolder } from "./lib/chatFolders";
import FolderPicker from "./components/FolderPicker";
import { shouldAutoload } from "./lib/mediaPolicy";
import EmojiPicker from "./components/EmojiPicker";
import VideoNoteRecorder from "./components/VideoNoteRecorder";
import { formatNoteTime } from "./lib/videoNote";
import { wallpaperBackground, wallpaperOpacity } from "./lib/wallpaper";
import PasscodeLock from "./components/PasscodeLock";
import { type MuteOptionId, muteUntil } from "./lib/chatSettings";
import { subscribeToPush } from "./lib/push";
import { useAutoScroll } from "./hooks/useAutoScroll";
import { unreadMessages } from "./lib/unread";
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
  // The profile panel is a grid column on wide screens and a drawer below
  // 1440px, so it starts closed: open by default it would cover the chat.
  const [showProfile, setShowProfile] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  // At 1440px and wider the panel is the third grid column and is always
  // visible; below that it is a drawer the user opens. One flag cannot express
  // both, so the layout asks the viewport.
  const [wideLayout, setWideLayout] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1440px)").matches : false
  );

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1440px)");
    const sync = () => setWideLayout(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const [membersRefreshKey, setMembersRefreshKey] = useState(0);
  const [pinnedMessageIds, setPinnedMessageIds] = useState<Set<number>>(() => new Set());
  const [uploadProgress, setUploadProgress] = useState<{ name: string; percent: number; stage: string } | null>(null);
  // A reply target is a message, so it can only be restored once the chats are known.
  // It starts empty and the restore pass below fills it from the stored draft.
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  // On a phone the chat list and the conversation cannot share the screen, so
  // one of them is always showing. On wider screens both are visible and this
  // state is ignored.
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacyPreferences>(DEFAULT_PRIVACY);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [blockedEntries, setBlockedEntries] = useState<string[]>([]);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);
  const [openMessageActionsId, setOpenMessageActionsId] = useState<number | null>(null);
  const [deletedMessage, setDeletedMessage] = useState<{ chatId: number; message: Message; index: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesAreaRef = useRef<HTMLDivElement | null>(null);

  const { notice, notify: action, clearNotice } = useNotice();
  const { theme, setTheme, textSize, setTextSize } = useTheme();
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
    avatarPath,
    setAvatarPath,
    about,
    saveAbout,
  } = useProfile({ notify: action });

  const { avatarUrl: selfAvatarUrl, uploading: avatarUploading, upload: uploadAvatar, remove: removeAvatar } = useAvatar({
    userId: accountId,
    storedPath: avatarPath,
    notify: action,
  });
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
  const { chats, setChats, activeId, setActiveId, drafts, setDrafts, replyDrafts, setReplyDrafts, activeChat, displayChats, visibleMessages, galleryImages, unreadTotal, toggleChatPin } =
    useChatCollection({ search, chatFilter, messageSearch, notify: action });
  const { foundUsers, userSearchLoading } = useUserSearch({ search, accountId });

  // A folder narrows the list rather than replacing it: search and the unread filter
  // still apply inside the folder, because those are what the reader is looking with.
  const {
    folders,
    createFolder,
    deleteFolder,
    renameFolder: renameChatFolder,
    moveFolder: moveChatFolder,
    toggleChat: toggleChatFolder,
  } = useChatFolders();
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [folderPickerChat, setFolderPickerChat] = useState<Chat | null>(null);

  const folderChats = useMemo(() => {
    const folder = folders.find((item) => item.id === activeFolderId);
    if (!folder) return displayChats;
    const inFolder = new Set(chatsInFolder(folder, chats).map((chat) => chat.id));
    return displayChats.filter((chat) => inFolder.has(chat.id));
  }, [activeFolderId, chats, displayChats, folders]);

  // Mirrors the chat list for timers and callbacks that must not be rebuilt
  // every time a message arrives.
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
    const reloadChatsRef = useRef<(() => void) | null>(null);
  useCloudChats({ accountId, profileReady, profileName, notify: action, setChats, setActiveId, reloadRef: reloadChatsRef });
  useRealtimeChat({
    accountId,
    profileName,
    remoteId: activeChat.remoteId,
    setChats,
    // A message can arrive before the chat list has finished loading. Without
    // this the event was dropped and the message never appeared.
    onMissingChat: async () => reloadChatsRef.current?.(),
  });
  // Signed attachment URLs last an hour; keep them alive in a long-lived tab.
  useAttachmentRefresh({ chats, enabled: Boolean(accountId), setChats });
  const {
    call,
    startCall,
    answer: answerCall,
    hangUp,
    media: callMedia,
    attachRemoteVideo,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
  } = useCalls({ accountId: accountId ?? null, enabled: Boolean(accountId), notify: action });
  const [callError, setCallError] = useState<string | null>(null);
  // Calls are cloud-only: a demo chat has no remoteId, so there is nothing to signal.
  const startCallNow = async (kind: "audio" | "video") => {
    setCallError(null);
    if (!activeChat.remoteId) {
      action("Звонки доступны в облачных чатах");
      return;
    }
    const result = await startCall(activeChat.remoteId, kind);
    if (result.error) setCallError(describeCallError(result.error));
  };
  // Hold the scroll while a chat is showing its unread divider. The holder is
  // cleared as soon as the message count changes, so a new message still pulls
  // the view down.
  // Non-null while the opened chat has unread messages the reader has not reached.
  const unreadHold = unreadMessages(activeChat) ? activeChat.id : null;
  useAutoScroll(messagesEndRef, [activeId, activeChat.messages.length], unreadHold);

  const { loadOlder, loadingChatIds } = useHistoryPagination({ accountId, profileName, notify: action, setChats });
  useInfiniteHistory(messagesAreaRef, activeChat, loadOlder);
  // Notification preferences live per device, and the permission state is read
  // once so the settings screen can say plainly whether the browser allows them.
  const { prefs: notificationPrefs, setPrefs: setNotificationPrefs } = useNotificationPrefs();
  // The language is a device preference, like the theme: a phone in English should
  // not change the laptop.
  const { language, setLanguage, t } = useLanguage();
  // A four-digit lock on this device, separate from the account password.
  const { passcode: lockCode, unlocked: lockUnlocked, setCode, unlock } = usePasscode();
  const { wallpaper, setWallpaper } = useWallpaper();
  const [emojiOpen, setEmojiOpen] = useState(false);
  // The message a search result points at. Cleared once the highlight has been shown.
  const [revealMessageId, setRevealMessageId] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const { policy: mediaPolicy, setPolicy: setMediaPolicy, network: networkKind } = useMediaPolicy();
  const autoloadMedia = shouldAutoload(mediaPolicy, networkKind);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Focusing the existing field rather than opening a second search: two search
  // boxes would mean two places to look for what you typed.
  const focusSearch = useCallback((kind: "chat" | "message") => {
    const selector = kind === "chat" ? ".chat-list-panel input" : ".messages-search input, .conversation-search input";
    const field = document.querySelector<HTMLInputElement>(selector);
    if (field) {
      field.focus();
      field.select();
    } else if (kind === "message") {
      setMessageSearchOpen(true);
    }
  }, []);

  // Each shortcut calls the same function the button calls, so the two can never
  // drift into doing different things.
  const onShortcut = useCallback(
    (shortcut: Shortcut) => {
      const chat = chats.find((item) => item.id === activeId);
      const last = chat?.messages[chat.messages.length - 1];
      switch (shortcut.key) {
        case "escape":
          setShortcutsOpen(false);
          setEmojiOpen(false);
          setOpenMessageActionsId(null);
          if (editingMessageId !== null) {
            setEditingMessageId(null);
            setEditDraft("");
          } else if (chatMenuOpen) {
            setChatMenuOpen(false);
          } else if (newChatOpen) {
            setNewChatOpen(false);
          } else if (messageSearchOpen) {
            setMessageSearchOpen(false);
          }
          return;
        case "k":
          focusSearch("chat");
          return;
        case "f":
          setMessageSearchOpen(true);
          return;
        case "n":
          setNewChatOpen(true);
          return;
        case "arrowup":
          // The composer is empty here, so the arrow is free to mean "edit the last".
          // An optimistic message has no id yet, so there is nothing to edit.
          if (last && last.id > 0) startEditing(last);
          return;
        case "arrowdown":
          if (editingMessageId !== null) {
            setEditingMessageId(null);
            setEditDraft("");
          }
          return;
        case "?":
          setShortcutsOpen((open) => !open);
          return;
        default:
          return;
      }
    },
    [activeId, chatMenuOpen, chats, editingMessageId, messageSearchOpen, newChatOpen]
  );

  useShortcuts({ onShortcut, enabled: !lockCode || lockUnlocked });

  // The swipe goes back exactly where the back button goes, so the two cannot
  // disagree about what "back" means.
  /**
   * Saves the conversation as a file.
   *
   * The text format is the default because a backup is only worth having if it can be
   * read years later by something other than this app.
   */
  function exportChat(chat: Chat) {
    const messages = chat.messages.filter((message) => message.id > 0);
    const text = exportAsText(
      chat.name,
      messages.map((message) => ({
        author: message.author,
        text: message.text,
        createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : undefined,
        attachment: message.attachment
          ? { name: message.attachment.name, type: message.attachment.type, size: message.attachment.size }
          : null,
      })),
      Date.now()
    );
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(chat.name, Date.now(), "txt");
    link.click();
    // Revoking immediately can cancel the download in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    action(`Переписка выгружена: ${pluralMessages(messages.length)}`);
  }

  const goBackToChats = useCallback(() => {
    if (mobileView !== "chat") return;
    setMobileView("list");
    if (window.history.state?.nexusChat) window.history.back();
  }, [mobileView]);
  useBackSwipe({ enabled: mobileView === "chat", onBack: goBackToChats });
  // TOTP two-factor, verified on the server: the app cannot declare itself verified.
  const twoFactorState = useTwoFactor(supabase, accountId);
  const twoFactor = {
    status: twoFactorState.status,
    pending: twoFactorState.pending,
    busy: twoFactorState.busy,
    error: twoFactorState.error,
    start: () => void twoFactorState.start(),
    confirm: (code: string) => void twoFactorState.confirm(code),
    cancel: () => void twoFactorState.cancel(),
    disable: () => void twoFactorState.disable(),
  };
  // Which chat the mute chooser is open for; null when it is closed.
  const [muteChatId, setMuteChatId] = useState<number | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );

  async function askForNotifications() {
    const permission = await requestNotificationPermission();
    setNotificationPermission(permission);
    if (permission === "granted" && accountId) {
      const result = await subscribeToPush(accountId);
      action(result === "subscribed" ? "Уведомления включены, в том числе в фоне" : "Уведомления включены");
    } else if (permission === "denied") {
      action("Браузер запретил уведомления — разреши их в настройках сайта");
    }
  }

  useUnreadBadge(unreadTotal);
  useMessageNotifications({ accountId, chats, prefs: notificationPrefs });
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
    if (file.size > MAX_UPLOAD_BYTES) {
      action(`Максимальный размер файла — ${formatBytes(MAX_UPLOAD_BYTES)}`);
      return;
    }
    if (!isSupportedFile(file.type)) {
      action("Этот формат файла пока не поддерживается");
      return;
    }

    // Photos are downscaled before upload: a 12 MP shot would otherwise waste
    // the user's traffic and the bucket budget for no visible gain.
    let payload: Blob = file;
    let uploadName = file.name;
    let meta: { name: string; type: string; size: number; width?: number; height?: number; thumbnail?: string } = {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
    };

    if (shouldCompress(file)) {
      setUploadProgress({ name: file.name, percent: 10, stage: "Сжимаю фото…" });
      const prepared = await prepareImage(file);
      payload = prepared.blob;
      uploadName = prepared.fileName;
      meta = {
        name: prepared.fileName,
        type: prepared.blob.type || file.type,
        size: prepared.blob.size,
        width: prepared.width || undefined,
        height: prepared.height || undefined,
        thumbnail: prepared.thumbnail || undefined,
      };
    }

    setUploadProgress({ name: uploadName, percent: 45, stage: "Отправляю файл…" });
    const path = buildStoragePath(chat.remoteId, accountId, uploadName, crypto.randomUUID());
    // storage-js 2.118 exposes no per-chunk callback, so the bar advances by
    // stage instead of pretending to know real byte progress.
    const uploaded = await client.storage.from("chat-media").upload(path, payload, { contentType: meta.type });
    if (uploaded.error) {
      setUploadProgress(null);
      action("Не удалось загрузить файл. Проверь миграцию online_media в Supabase.");
      return;
    }
    setUploadProgress({ name: uploadName, percent: 80, stage: "Публикую сообщение…" });
    const signed = await client.storage.from("chat-media").createSignedUrl(path, 3600);
    if (signed.error || !signed.data?.signedUrl) {
      setUploadProgress(null);
      action("Не удалось получить ссылку на файл");
      return;
    }
    const attachmentMeta = { ...meta, path };
    const inserted = await client.from("messages").insert({ chat_id: chat.remoteId, sender_id: accountId, body: uploadName, attachment: attachmentMeta }).select("id, created_at").single();
    if (inserted.error || !inserted.data) {
      // The row is the source of truth; a stored file without it is orphaned.
      await client.storage.from("chat-media").remove([path]);
      setUploadProgress(null);
      action("Не удалось отправить вложение");
      return;
    }
    const row = inserted.data;
    const created = new Date(row.created_at);
    const message: Message = {
      id: numericId(row.id),
      remoteId: row.id,
      author: profileName,
      text: uploadName,
      time: clockTime(created),
      mine: true,
      createdAt: created.getTime(),
      attachment: {
        ...attachmentMeta,
        data: signed.data.signedUrl,
        expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
      },
    };
    setChats((current) => appendMessage(current, activeId, message, "📎 " + uploadName, message.time));
    setUploadProgress({ name: uploadName, percent: 100, stage: "Готово" });
    window.setTimeout(() => setUploadProgress(null), 900);
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
    // Option ids only need to be unique within this poll, so this timestamp is used
    // for naming them; where the poll sits is decided by the server below.
    let createdAt = Date.now();
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
      // Same reason as a plain message: the server's clock decides where it sits.
      createdAt = new Date(data.created_at).getTime();
    } else if (client && accountId) {
      action("Этот чат локальный. Создай облачный чат, чтобы опрос синхронизировался.");
      return;
    }
    const time = clockTime(new Date(createdAt));
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
        void sendVoiceMessage(blob);
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

  /**
   * Uploads a finished recording to Storage and publishes it as a message.
   *
   * The audio has to live in the bucket like any other attachment: keeping it
   * inline meant the recipient never received it, because the message row was
   * only ever written to local state.
   */
  async function sendVoiceMessage(blob: Blob) {
    const duration = Math.max(1, Math.round((Date.now() - (recordingStartedRef.current || Date.now())) / 1000));
    const time = clockTime();
    const createdAt = Date.now();
    const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
    const fileName = `voice-${createdAt}.${extension}`;
    const chat = chats.find((item) => item.id === activeId);
    const client = supabase;

    // A local-only chat has nowhere to upload to; keep an inline copy so the
    // bubble still plays back in this session.
    if (!chat?.remoteId || !client || !accountId) {
      const data = await blobToDataUrl(blob);
      const message: Message = {
        id: createdAt,
        author: profileName,
        text: `Голосовое сообщение · ${duration} сек.`,
        time,
        mine: true,
        createdAt,
        attachment: { name: fileName, type: blob.type || "audio/webm", data, size: blob.size, duration },
      };
      setChats((current) => appendMessage(current, activeId, message, "🎤 Голосовое сообщение", time));
      setRecordingSeconds(0);
      action("Голосовое сообщение добавлено в этот браузер");
      return;
    }

    setUploadProgress({ name: fileName, percent: 30, stage: "Отправляю голосовое…" });
    const path = buildStoragePath(chat.remoteId, accountId, fileName, crypto.randomUUID());
    const uploaded = await client.storage.from("chat-media").upload(path, blob, { contentType: blob.type || "audio/webm" });
    if (uploaded.error) {
      setUploadProgress(null);
      action("Не удалось загрузить голосовое сообщение");
      return;
    }

    const waveform = await analyseWaveform(blob);
    setUploadProgress({ name: fileName, percent: 70, stage: "Публикую сообщение…" });
    const signed = await client.storage.from("chat-media").createSignedUrl(path, 3600);
    const meta = {
      name: fileName,
      type: blob.type || "audio/webm",
      size: blob.size,
      path,
      duration,
      waveform,
    };
    const inserted = await client
      .from("messages")
      .insert({ chat_id: chat.remoteId, sender_id: accountId, body: `Голосовое сообщение · ${duration} сек.`, attachment: meta })
      .select("id, created_at")
      .single();
    if (inserted.error || !inserted.data) {
      await client.storage.from("chat-media").remove([path]);
      setUploadProgress(null);
      action("Не удалось отправить голосовое сообщение");
      return;
    }

    const row = inserted.data;
    const created = new Date(row.created_at);
    const message: Message = {
      id: numericId(row.id),
      remoteId: row.id,
      author: profileName,
      text: `Голосовое сообщение · ${duration} сек.`,
      time: clockTime(created),
      mine: true,
      createdAt: created.getTime(),
      attachment: {
        ...meta,
        data: signed.data?.signedUrl ?? "",
        expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
      },
    };
    setChats((current) => appendMessage(current, activeId, message, "🎤 Голосовое сообщение", message.time));
    setUploadProgress(null);
    setRecordingSeconds(0);
    action("Голосовое сообщение отправлено");
  }

  /** Loads the stored preferences and the block list once the account is known. */
  useEffect(() => {
    const client = supabase;
    if (!client || !accountId) return;
    let active = true;
    void (async () => {
      const stored = await fetchPrivacyPreferences(client, accountId);
      if (active) setPrivacy(stored);
      const blocked = await fetchBlockedIds(client);
      if (!active || blocked.length === 0) {
        if (active) setBlockedEntries([]);
        return;
      }
      // Resolve names once, so the modal can list "id:name" pairs.
      const { data } = await client.from("profiles").select("id, display_name").in("id", blocked);
      const names = new Map((data ?? []).map((row) => [row.id as string, row.display_name as string]));
      if (active) setBlockedEntries(blocked.map((id) => `${id}:${names.get(id) ?? "Пользователь"}`));
    })();
    return () => {
      active = false;
    };
  }, [accountId]);

  async function changePrivacy(next: PrivacyPreferences) {
    const client = supabase;
    const previous = privacy;
    setPrivacy(next);
    if (!client || !accountId) return;
    setPrivacySaving(true);
    const result = await savePrivacyPreferences(client, accountId, next);
    setPrivacySaving(false);
    if (!result.ok) {
      setPrivacy(previous);
      action("Не удалось сохранить настройку приватности");
    }
  }

  async function unblockPerson(userId: string) {
    const client = supabase;
    if (!client) return;
    const result = await unblockUser(client, userId);
    if (!result.ok) {
      action(result.message);
      return;
    }
    setBlockedEntries((current) => current.filter((entry) => !entry.startsWith(`${userId}:`)));
    action("Пользователь разблокирован");
  }

  async function confirmDeleteAccount() {
    const client = supabase;
    if (!client) return;
    if (!window.confirm("Удалить аккаунт навсегда? Это действие нельзя отменить.")) return;
    setDeletingAccount(true);
    const result = await deleteAccount(client);
    setDeletingAccount(false);
    if (!result.ok) {
      action(result.message);
      return;
    }
    action("Аккаунт удалён");
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
  async function openSearchHit(hitCreatedAt: string, hitRemoteId?: string) {
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

    // The pages are in; now put the message on screen and make it obvious which one it
    // is. Finding a message without showing where it lives only proves it exists.
    setRevealMessageId(hitRemoteId ?? null);
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
    // The server's clock decides the order, so its timestamp is what gets stored.
    // Falling back to this device is only for chats that live in this browser.
    let createdAt = Date.now();
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
      // A dropped connection is ordinary on a phone; retrying saves the user from
      // retyping a message that would have gone through a second later. The query
      // builder is a thenable rather than a promise, so it is awaited here.
      const inserted = await withRetry(
        async () =>
          client.from("messages").insert({ chat_id: targetChat.remoteId, sender_id: accountId, body: text }).select("id, created_at").single(),
        { shouldRetry: (error) => isTransientError(error) }
      ).catch((error: unknown) => ({ error }));
      const { data, error } = inserted as { data?: { id: string; created_at: string } | null; error?: unknown };
      if (error || !data) {
        action("Сообщение не отправлено. Проверь подключение и права Supabase.");
        return;
      }
      remoteMessageId = data.id;
      createdAt = new Date(data.created_at).getTime();
    } else if (client && accountId) {
      action("Этот чат локальный. Начни переписку, выбрав пользователя по @username.");
      return;
    }
    const message: Message = {
      id: remoteMessageId ? numericId(remoteMessageId) : createdAt,
      ...(remoteMessageId ? { remoteId: remoteMessageId } : {}),
      author: profileName,
      text,
      time: clockTime(new Date(createdAt)),
      mine: true,
      createdAt,
      ...(replyTo ? { replyTo } : {}),
    };
    // Placed by timestamp rather than appended: the server's clock may put this
    // message just before the newest one already on screen.
    setChats((current) =>
      updateChat(current, activeId, (chat) => ({
        ...chat,
        preview: message.text,
        time: message.time,
        messages: placeNewMessage(chat.messages, message),
      }))
    );
    setDraft("");
    setDrafts((current) => ({ ...current, [activeId]: "" }));
    setReplyDrafts((current) => ({ ...current, [activeId]: { author: "", text: "" } }));
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

  // History is fetched once when the app loads, but messages keep arriving while
  // another chat is open, and the realtime channel only listens to the active
  // chat. Without this refresh the conversation can show "no messages yet"
  // although the database already holds them.
  async function refreshChatMessages(chat: Chat) {
    if (!chat.remoteId || !accountId) return;
    const messages = await loadMessagePage({
      chatId: chat.remoteId,
      accountId,
      selfName: profileName,
      authorName: "Собеседник",
    });
    if (!messages || !messages.length) return;
    setChats((current) =>
      current.map((item) => {
        if (item.id !== chat.id) return item;
        // Merge by remote id so locally appended messages are not duplicated.
        const known = new Set(item.messages.map((message) => message.remoteId).filter(Boolean));
        const merged = [...item.messages, ...messages.filter((message) => !known.has(message.remoteId))];
        merged.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
        const last = merged[merged.length - 1];
        return { ...item, messages: merged, preview: last?.text ?? item.preview, time: last?.time ?? item.time };
      })
    );
  }

  // Realtime is the fast path for incoming messages, but it can be unavailable
  // (server outage, blocked websocket, backgrounded tab). This refresh keeps the
  // open conversation correct in that case, so a delivery failure costs a few
  // seconds instead of the message.
  //
  // The target chat lives in a ref rather than in the dependency array: a new
  // dependency value tore down and recreated the timer, and any refresh that was
  // due in that window was skipped - which is exactly when it was needed.
  const pollTargetRef = useRef<{ chatId: number; remoteId: string } | null>(null);
  pollTargetRef.current = activeChat.remoteId ? { chatId: activeChat.id, remoteId: activeChat.remoteId } : null;
  useEffect(() => {
    if (!accountId) return;
    const timer = setInterval(() => {
      const target = pollTargetRef.current;
      if (!target || document.visibilityState !== "visible") return;
      const chat = chatsRef.current.find((item) => item.id === target.chatId);
      if (chat) void refreshChatMessages(chat);
    }, 15000);
    return () => clearInterval(timer);
    // refreshChatMessages is intentionally not a dependency: it is recreated on
    // every render, and depending on it would restart the interval constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

// The Android back gesture should leave the conversation, not the app.
  useEffect(() => {
    function onPopState() {
      setMobileView("list");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // The draft for the chat that opens on load, which selectChat would have filled if the
  // user had chosen it. Without this the text is stored and never shown.
  const restoredDraftFor = useRef<number | null>(null);
  useEffect(() => {
    if (restoredDraftFor.current === activeId) return;
    restoredDraftFor.current = activeId;
    const stored = drafts[activeId];
    if (stored) setDraft(stored);
  }, [activeId, drafts]);

  async function selectChat(chat: Chat) {
    setActiveId(chat.id);
    setMobileView("chat");
    if (window.matchMedia("(max-width: 760px)").matches) window.history.pushState({ nexusChat: chat.id }, "");
    setDraft(drafts[chat.id] ?? "");
    setMessageSearch("");
    setChats((current) => markRead(current, chat.id));
    const client = supabase;
    if (!client || !accountId || !chat.remoteId) return;
    void refreshChatMessages(chat);
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

  /**
   * Removes a message from this account's view only.
   *
   * Nothing is written to the other side: "у себя" is a viewing preference, not a
   * statement about the conversation. The row stays hidden until the next full
   * reload, which is what other messengers do too.
   */
  /**
   * Chat-level settings live on this account's membership row, so the change
   * applies to this person only and follows them to another device.
   */
  async function saveChatSettings(chatId: number, patch: { mutedUntil?: number | null; archived?: boolean }) {
    const chat = chats.find((item) => item.id === chatId);
    if (!chat?.remoteId) {
      // Demo chats have no server row; keep the change in memory.
      setChats((current) =>
        current.map((item) =>
          item.id === chatId
            ? {
                ...item,
                ...(patch.mutedUntil !== undefined ? { mutedUntil: patch.mutedUntil } : {}),
                ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
              }
            : item
        )
      );
      return true;
    }
    const client = supabase;
    if (!client || !accountId) {
      action("Нет подключения к Supabase");
      return false;
    }
    // Through the function rather than a direct UPDATE: a row policy cannot limit
    // which columns an update touches, and a member able to write any column can
    // write role.
    const { error } = await client.rpc("set_chat_preferences", {
      p_chat: chat.remoteId,
      p_muted_until:
        patch.mutedUntil === undefined || patch.mutedUntil === null
          ? null
          : new Date(patch.mutedUntil).toISOString(),
      p_archived: patch.archived === undefined ? null : patch.archived,
    });
    if (error) {
      action("Не удалось сохранить настройку чата");
      return false;
    }
    setChats((current) =>
      current.map((item) =>
        item.id === chatId
          ? {
              ...item,
              ...(patch.mutedUntil !== undefined ? { mutedUntil: patch.mutedUntil } : {}),
              ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
            }
          : item
      )
    );
    return true;
  }

  // The media total and the settings keys this browser actually holds.
  const attachmentBytes = useMemo(() => mediaBytes(chats.flatMap((chat) => chat.messages)), [chats]);
  const attachmentCount = useMemo(
    () => chats.reduce((sum, chat) => sum + chat.messages.filter((message) => message.attachment).length, 0),
    [chats]
  );
  const [cacheKeys, setCacheKeys] = useState<string[]>([]);
  const [clearingCache, setClearingCache] = useState(false);

  useEffect(() => {
    try {
      setCacheKeys(presentCacheKeys(CACHE_KEYS, (key) => window.localStorage.getItem(key) !== null));
    } catch {
      // Storage blocked: nothing to clear and nothing to offer.
      setCacheKeys([]);
    }
  }, [profileOpen]);

  // Who may find and write to this account. Stored on the profile, because the
  // rules are enforced server-side where the search and chat creation happen.
  const [visibility, setVisibilityState] = useState<VisibilitySettings>(DEFAULT_VISIBILITY);

  useEffect(() => {
    const client = supabase;
    if (!client || !accountId) return;
    let alive = true;
    void client
      .from("profiles")
      .select("profile_visibility, message_policy")
      .eq("id", accountId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return;
        setVisibilityState(parseVisibility({ profile: data.profile_visibility, messages: data.message_policy }));
      });
    return () => {
      alive = false;
    };
  }, [accountId]);

  // This device's own short record. Supabase does not expose the list of signed-in
  // devices to the client, so the app keeps a hint of its own; the only action it
  // enables - signing out everywhere else - the server performs for real.
  const [deviceId] = useState(() => {
    try {
      const existing = window.localStorage.getItem("nexus-device-id");
      if (existing) return existing;
      const created = Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.localStorage.setItem("nexus-device-id", created);
      return created;
    } catch {
      return "local";
    }
  });
  const [devices, setDevices] = useState<SessionRecord[]>([]);
  const [signingOutOthers, setSigningOutOthers] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    const { label, platform } = describeDevice(navigator.userAgent);
    try {
      const stored = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || "[]") as SessionRecord[];
      const next = upsertSession(stored, { deviceId, label, platform, lastSeen: Date.now() }, Date.now());
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
      setDevices(next);
    } catch {
      // Storage blocked: the list is simply unavailable.
      setDevices([{ deviceId, label, platform, lastSeen: Date.now() }]);
    }
  }, [accountId, deviceId]);

  async function signOutOtherDevices() {
    const client = supabase;
    if (!client) {
      action("Нет подключения к Supabase");
      return;
    }
    setSigningOutOthers(true);
    try {
      // scope "others" keeps this session and revokes the rest - the point of the
      // button is to stay here and end everywhere else.
      const { error } = await client.auth.signOut({ scope: "others" });
      if (error) {
        action("Не удалось завершить другие сессии");
        return;
      }
      const kept = devices.filter((device) => device.deviceId === deviceId);
      try {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(kept));
      } catch {
        // Nothing to record; the sign-out itself already happened.
      }
      setDevices(kept);
      action("Другие сессии завершены");
    } finally {
      setSigningOutOthers(false);
    }
  }

  async function changeVisibility(next: VisibilitySettings) {
    const previous = visibility;
    setVisibilityState(next);
    const client = supabase;
    if (!client || !accountId) {
      action("Настройка сохранена");
      return;
    }
    const { error } = await client
      .from("profiles")
      .update({ profile_visibility: next.profile, message_policy: next.messages })
      .eq("id", accountId);
    if (error) {
      // Put it back rather than showing a switch that saved nothing.
      setVisibilityState(previous);
      action("Не удалось сохранить настройку видимости");
      return;
    }
    action(describeVisibility(next));
  }

  async function clearCache() {
    setClearingCache(true);
    try {
      for (const key of cacheKeys) window.localStorage.removeItem(key);
      // The service-worker cache is separate from local storage and is the part
      // that actually grows.
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
      setCacheKeys([]);
      action("Кеш очищен");
    } catch {
      action("Не удалось очистить кеш");
    } finally {
      setClearingCache(false);
    }
  }

  async function applyMute(optionId: MuteOptionId) {
    if (muteChatId === null) return;
    const until = muteUntil(optionId, new Date());
    setMuteChatId(null);
    const ok = await saveChatSettings(muteChatId, { mutedUntil: until ? until.getTime() : null });
    if (ok) action(until ? "Уведомления из чата отключены" : "Звук включён");
  }

  async function deleteMessageLocal(messageId: number) {
    const chat = chats.find((item) => item.id === activeId);
    const index = chat?.messages.findIndex((message) => message.id === messageId) ?? -1;
    const message = index >= 0 ? chat?.messages[index] : undefined;
    if (!chat || !message) return;
    if (chat.remoteId && message.remoteId && supabase && accountId) {
      // Recorded per account so the row does not come back on reload.
      await supabase.from("message_hides").upsert(
        { message_id: message.remoteId, user_id: accountId },
        { onConflict: "message_id,user_id" }
      );
    }
    setDeletedMessage({ chatId: activeId, message, index });
    setChats((current) => removeMessage(current, activeId, messageId).chats);
    setOpenMessageActionsId(null);
    action("Удалено у вас");
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

  function addEmoji(char = "🙂") {
    if (editingMessageId !== null) setEditDraft((value) => value + char);
    else setDraft((value) => value + char);
    setEmojiOpen(false);
  }

  function copyMessage(message: Message) {
    navigator.clipboard
      ?.writeText(message.text)
      .then(() => action("Текст скопирован"))
      .catch(() => action("Не удалось скопировать текст"));
    setOpenMessageActionsId(null);
  }

  // A reply that outlives a reload, the same way the text of a draft does. The stored
  // draft names the message by author and quoted text rather than by id, because a local
  // message id is not stable across a reload and the quote is what the reader sees.
  const restoredReplyFor = useRef<number | null>(null);
  useEffect(() => {
    if (restoredReplyFor.current === activeId) return;
    restoredReplyFor.current = activeId;
    const stored = replyDrafts[activeId];
    if (!stored?.text) return;
    setReplyTarget({ id: -1, author: stored.author, text: stored.text, time: "", createdAt: 0, mine: false });
  }, [activeId, replyDrafts]);

  function replyToMessage(message: Message) {
    setReplyTarget(message);
    setReplyDrafts((current) => ({ ...current, [activeId]: { author: message.author, text: message.text } }));
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

  // A lock screen with the app still rendered underneath is one CSS mistake away
  // from showing a message, so the shell is replaced rather than covered.
  if (lockCode && !lockUnlocked) {
    return <PasscodeLock passcode={lockCode} onUnlock={unlock} />;
  }

  return (
    <main className={`app-shell ${mobileView === "chat" ? "mobile-chat" : "mobile-list"}`}>
      <Rail
        t={t}
        activeNav={activeNav}
        profileName={profileName}
        profileAvatar={profileAvatar}
        selfAvatarUrl={selfAvatarUrl}
        unreadTotal={unreadTotal}
        onNavigate={(label) => {
          setActiveNav(label);
          setMobileView("list");
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
        folders={folders}
        activeFolderId={activeFolderId}
        onSelectFolder={setActiveFolderId}
        onCreateFolder={createFolder}
        onRenameFolder={renameChatFolder}
        onMoveFolder={moveChatFolder}
        onDeleteFolder={(id) => {
          deleteFolder(id);
          if (activeFolderId === id) setActiveFolderId(null);
        }}
        chats={folderChats}
        allChats={chats}
        hasVisibleChats={folderChats.length > 0}
        activeId={activeId}
        onSelectChat={selectChat}
        onTogglePin={toggleChatPin}
      />

      <ConversationPanel
        chat={activeChat}
        onBack={goBackToChats}
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
        onOpenSearchHit={(createdAt, remoteId) => void openSearchHit(createdAt, remoteId)}
        onCall={() => void startCallNow("audio")}
        onVideo={() => void startCallNow("video")}
        onTogglePin={() => toggleChatPin(activeChat)}
        onToggleProfile={() => {
          setChatMenuOpen(false);
          setShowProfile((open) => !open);
        }}
        onExport={() => {
          setChatMenuOpen(false);
          exportChat(activeChat);
        }}
        onFolders={() => {
          setChatMenuOpen(false);
          setFolderPickerChat(activeChat);
        }}
        onClearHistory={() => {
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
        wallpaper={wallpaper}
        autoloadMedia={autoloadMedia}
        onArchive={() => {
          setChatMenuOpen(false);
          const next = !activeChat.archived;
          void saveChatSettings(activeChat.id, { archived: next }).then(
            (ok) => ok && action(next ? "Чат в архиве" : "Чат возвращён из архива")
          );
        }}
        chatMenuOpen={chatMenuOpen}
        onToggleChatMenu={() => setChatMenuOpen((open) => !open)}
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
        onDeleteLocal={(messageId) => void deleteMessageLocal(messageId)}
        onGameInvite={() => action("Приглашение в игру скоро появится")}
        typingNames={typingUsers.map((user) => user.name)}
        uploadProgress={uploadProgress}
        peerOnline={peerOnline}
        peerLastSeenAt={peerLastSeenAt}
        endRef={messagesEndRef}
        messagesRef={messagesAreaRef}
        revealMessageId={revealMessageId}
        onRevealed={() => setRevealMessageId(null)}
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
          onEmoji: () => setEmojiOpen((open) => !open),
          onVideoNote: () => setNoteOpen(true),
          onToggleVoice: () => void startVoiceRecording(),
          onSubmit: sendMessage,
          onCancelEdit: () => {
            setEditingMessageId(null);
            setEditDraft("");
          },
          onCancelReply: () => {
          setReplyTarget(null);
          setReplyDrafts((current) => ({ ...current, [activeId]: { author: "", text: "" } }));
        },
          onChooseMention: chooseMention,
          onAttachment: (event) => void handleAttachment(event),
          onOpenGallery: () => setGalleryOpen(true),
          onOpenPoll: () => setPollOpen(true),
        }}
      />

      {shortcutsOpen && <ShortcutHelp onClose={() => setShortcutsOpen(false)} />}

      {folderPickerChat && (
        <FolderPicker
          chat={folderPickerChat}
          folders={folders}
          onToggle={toggleChatFolder}
          onClose={() => setFolderPickerChat(null)}
        />
      )}

      {noteOpen && (
        <VideoNoteRecorder
          onSend={(file, durationMs) => {
            setNoteOpen(false);
            const input = fileInputRef.current;
            if (!input) {
              action("Не удалось отправить видеозаметку");
              return;
            }
            // The note's length belongs in the message, so it is written into the
            // name the attachment path reads.
            const named = new File([file], `Видеозаметка ${formatNoteTime(durationMs)}.webm`, { type: file.type });
            const transfer = new DataTransfer();
            transfer.items.add(named);
            input.files = transfer.files;
            void handleAttachment({ target: input } as unknown as ChangeEvent<HTMLInputElement>);
          }}
          onClose={() => setNoteOpen(false)}
        />
      )}

      {emojiOpen && (
        <EmojiPicker
          onPick={(char) => {
            addEmoji(char);
            setEmojiOpen(false);
          }}
          onClose={() => setEmojiOpen(false)}
        />
      )}

      {(wideLayout || showProfile) && (
        <RightPanel
          profileName={profileName}
          profileAvatar={profileAvatar}
          selfAvatarUrl={selfAvatarUrl}
          selfAbout={about}
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

      <MuteModal
        open={muteChatId !== null}
        chatName={chats.find((chat) => chat.id === muteChatId)?.name ?? ""}
        onPick={(optionId) => void applyMute(optionId)}
        onClose={() => setMuteChatId(null)}
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

      <CallOverlay
        call={call}
        chatName={activeChat.name}
        chatColor={activeChat.color ?? "yellow"}
        error={callError ?? callMedia.error}
        connected={callMedia.connected}
        onAnswer={() => void answerCall()}
        onDecline={() => void hangUp("declined")}
        onHangUp={() => void hangUp("ended")}
        onToggleMute={() => void toggleMute()}
        onToggleCamera={() => void toggleCamera()}
        screenSharing={callMedia.screenSharing}
        onToggleScreenShare={() => void toggleScreenShare()}
        muted={callMedia.micEnabled === false}
        cameraOff={callMedia.cameraEnabled === false}
        onRemoteVideo={attachRemoteVideo}
        participants={callMedia.participants}
      />

      <PrivacyModal
        open={privacyOpen}
        preferences={privacy}
        blockedNames={blockedEntries}
        saving={privacySaving}
        deleting={deletingAccount}
        onChange={(next) => void changePrivacy(next)}
        visibility={visibility}
        onVisibilityChange={(next) => void changeVisibility(next)}
        onUnblock={(userId) => void unblockPerson(userId)}
        onDeleteAccount={() => void confirmDeleteAccount()}
        onClose={() => setPrivacyOpen(false)}
      />

      <SettingsModal
        open={profileOpen}
        name={profileName}
        avatar={profileAvatar}
        avatarPhotoUrl={selfAvatarUrl}
        avatarUploading={avatarUploading}
        onAvatarFile={(file) => void uploadAvatar(file)}
        onAvatarRemove={() => void removeAvatar()}
        username={username}
        about={about}
        onAboutSave={(value) => void saveAbout(value)}
        usernameSaving={usernameSaving}
        theme={theme}
        textSize={textSize}
        onTextSizeChange={setTextSize}
        onClose={() => setProfileOpen(false)}
        onNameChange={setProfileName}
        onAvatarChange={setProfileAvatar}
        onUsernameChange={setUsername}
        onSaveUsername={() => void saveUsername()}
        onThemeChange={setTheme}
        onOpenPrivacy={() => setPrivacyOpen(true)}
        prefs={notificationPrefs}
        onPrefsChange={setNotificationPrefs}
        permission={notificationPermission}
        onRequestPermission={() => void askForNotifications()}
        mediaBytes={attachmentBytes}
        attachmentCount={attachmentCount}
        cacheKeys={cacheKeys}
        onClearCache={() => void clearCache()}
        clearing={clearingCache}
        language={language}
        onLanguageChange={setLanguage}
        devices={devices}
        currentDeviceId={deviceId}
        onSignOutOthers={() => void signOutOtherDevices()}
        signingOut={signingOutOthers}
        passcode={lockCode}
        onPasscodeChange={setCode}
        twoFactor={twoFactor}
        wallpaper={wallpaper}
        onWallpaperChange={setWallpaper}
        mediaPolicy={mediaPolicy}
        onMediaPolicyChange={setMediaPolicy}
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
    </main>
  );
}
