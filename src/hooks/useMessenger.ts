import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Shield, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import Rail from "../components/Rail";
import ChatListPanel from "../components/ChatListPanel";
import ConversationPanel from "../components/ConversationPanel";
import RightPanel from "../components/RightPanel";
import GameModal from "../components/GameModal";
import { useChatMembers } from "../hooks/useChatMembers";
import { useServerSearch } from "../hooks/useServerSearch";
import PrivacyModal from "../components/PrivacyModal";
import SettingsModal from "../components/SettingsModal";
import { CallOverlay } from "../components/CallOverlay";
import { useCallController } from "./useCallController";
import { useAttachmentSender } from "./useAttachmentSender";
import { useMessageActions } from "./useMessageActions";
import { useComposer } from "./useComposer";
import {
  DEFAULT_PRIVACY,
  blockUser,
  deleteAccount,
  fetchBlockedIds,
  fetchPrivacyPreferences,
  savePrivacyPreferences,
  unblockUser,
} from "../lib/privacy";
import type { PrivacyPreferences } from "../lib/privacy";
import { removeMember, rotateInvite, setMemberRole } from "../lib/groupAdmin";
import { CACHE_KEYS, mediaBytes, presentCacheKeys } from "../lib/storageUsage";
import { SESSION_STORAGE_KEY, type SessionRecord, describeDevice, upsertSession } from "../lib/sessions";
import {
  DEFAULT_VISIBILITY,
  type VisibilitySettings,
  describeVisibility,
  parseVisibility,
} from "../lib/visibility";
import { createFavouritesChat, favouriteMessage, formatForwardText, isFavouritesChat, nextLocalId } from "../lib/messageActions";
import { MAX_UPLOAD_BYTES, blobToDataUrl, buildStoragePath, formatBytes, isSupportedFile, prepareImage, shouldCompress } from "../lib/media";
import { analyseWaveform } from "../lib/voice";
import { GalleryModal, MuteModal, NewChatModal, PollModal } from "../components/Modals";
import { friends, isDemoMode } from "../lib/constants";
import { clockTime, numericId } from "../lib/format";
import { appendMessage, applyReadStamp, directChatFromSearch, findDirectChatByPeer, mapMessages, markRead, removeChat, removeMessage, restoreMessage, updateChat } from "../lib/chats";
import { placeNewMessage } from "../lib/messageOrder";
import { sendText } from "../lib/sendText";

import { toggleLocalVote } from "../lib/polls";
import { useNotice } from "../hooks/useNotice";
import { useTheme } from "../hooks/useTheme";
import { useProfile } from "../hooks/useProfile";
import { useAvatar } from "../hooks/useAvatar";
import { usePeerProfiles } from "./usePeerProfiles";
import { useTextOutbox } from "./useTextOutbox";
import { viewOnceReady } from "../lib/viewOnceCloud";
import { exceedsMessageLimit, MESSAGE_TOO_LONG } from "../lib/messageLimits";
import { useGames } from "../hooks/useGames";
import { encodeInvitation } from "../games/core/invitation";
import type { GameKind } from "../games/core/types";
import { useChatCollection } from "../hooks/useChatCollection";
import { useUserSearch } from "../hooks/useUserSearch";
import { useCloudChats } from "../hooks/useCloudChats";
import { useRealtimeChat } from "../hooks/useRealtimeChat";
import { useAttachmentRefresh } from "../hooks/useAttachmentRefresh";
import { SIGNED_URL_TTL_SECONDS } from "../lib/messageSync";
import { loadMessagePage } from "../lib/messageLoader";
import { useHistoryPagination, useInfiniteHistory } from "../hooks/useHistoryPagination";
import { useUnreadBadge, useMessageNotifications, usePushSubscriptionSync, useNotificationsPrompt, requestNotificationPermission } from "../hooks/useNotifications";
import { useNotificationPrefs } from "../hooks/useNotificationPrefs";
import { usePrivacyPrefs } from "../hooks/usePrivacyPrefs";
import { stickerById, stickerMarkup } from "../lib/stickers";
import { formatSendAt } from "../lib/scheduling";
import { splitIntoAlbums } from "../lib/albums";
import { addPending, pendingForChat, removePending, type PendingAttachment } from "../lib/retryQueue";
import { useLanguage } from "../hooks/useLanguage";
import { usePasscode } from "../hooks/usePasscode";
import { useTwoFactor } from "../hooks/useTwoFactor";
import { useWallpaper } from "../hooks/useWallpaper";
import { useMediaPolicy } from "../hooks/useMediaPolicy";
import { useShortcuts } from "../hooks/useShortcuts";
import { useBackSwipe } from "../hooks/useBackSwipe";
import ShortcutHelp from "../components/ShortcutHelp";
import type { Shortcut } from "../lib/shortcuts";
import { exportAsText, exportFileName, pluralMessages } from "../lib/exportChat";
import { archiveName, buildAccountArchive, chatAsText, chatAsTextCount, downloadText, pluralFor } from "../lib/exportAccount";
import { useChatFolders } from "../hooks/useChatFolders";
import { chatsInFolder } from "../lib/chatFolders";
import FolderPicker from "../components/FolderPicker";
import { shouldAutoload } from "../lib/mediaPolicy";
import EmojiPicker from "../components/EmojiPicker";
import VideoNoteRecorder from "../components/VideoNoteRecorder";
import { formatNoteTime } from "../lib/videoNote";
import { wallpaperBackground, wallpaperOpacity } from "../lib/wallpaper";
import PasscodeLock from "../components/PasscodeLock";
import { type MuteOptionId, muteUntil } from "../lib/chatSettings";
import { subscribeToPush } from "../lib/push";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { unreadMessages } from "../lib/unread";
import { useTyping } from "../hooks/useTyping";
import { usePresence } from "../hooks/usePresence";
import type { Attachment, Chat, ChatFilter, Message, MessageEffect, UserSearchResult } from "../types";


/**
 * Everything the messenger does, kept apart from how it looks.
 *
 * This was the body of App, and at two thousand lines a single file that holds the state,
 * every effect and the markup made almost every change touch all three. The split is by
 * kind rather than by feature: all the state and the handlers live here, App keeps the
 * layout. Nothing was rewritten in the move, which is why the behaviour is unchanged.
 */
export function useMessenger() {
  const [search, setSearch] = useState("");
  const [chatFilter, setChatFilter] = useState<ChatFilter>("all");
  const [messageSearch, setMessageSearch] = useState("");
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [draft, setDraft] = useState("");
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
  // Files that failed to send, kept in memory so the person can retry without finding them
  // again. Deliberately not persisted: a photo should not survive the tab closing.
  // A reply target is a message, so it can only be restored once the chats are known.
  // It starts empty and the restore pass below fills it from the stored draft.
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  // On a phone the chat list and the conversation cannot share the screen, so
  // one of them is always showing. On wider screens both are visible and this
  // state is ignored.
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  // A tab in the background is not being read. Kept in state rather than read at the moment
  // of the event so the value the subscription sees is the one the reader last saw.
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const [openedChatId, setOpenedChatId] = useState<number | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacyPreferences>(DEFAULT_PRIVACY);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [blockedEntries, setBlockedEntries] = useState<string[]>([]);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);
  const [openMessageActionsId, setOpenMessageActionsId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  /** The scrolling list itself, which is what the reader actually looks at. */
  const messagesListRef = useRef<HTMLDivElement | null>(null);
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
  const { activeGame, setActiveGame, openGame } = useGames();
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
  const { queueText, retryMessage } = useTextOutbox({ accountId, profileName, chats, setChats });
  usePeerProfiles({ accountId, chats, setChats });
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
    const reloadChatsRef = useRef<(() => void) | null>(null);
  useCloudChats({ accountId, profileReady, profileName, notify: action, setChats, setActiveId, reloadRef: reloadChatsRef });
  const chatOnScreen = openedChatId !== null && openedChatId === activeId;
  useRealtimeChat({
    accountId,
    profileName,
    remoteId: activeChat.remoteId,
    setChats,
    // Three things have to be true for the reader to have seen a message: the conversation
    // is the open one, the phone is not parked on the chat list, and the tab is in front.
    visible: {
      chatOpen: chatOnScreen,
      conversationOnScreen: mobileView === "chat",
      documentVisible,
    },
    // A message can arrive before the chat list has finished loading. Without
    // this the event was dropped and the message never appeared.
    onMissingChat: async () => reloadChatsRef.current?.(),
    // When the socket drops and comes back, whatever was written in between was never
    // delivered. The list is refetched from the database rather than patched by guesswork:
    // a merge that only appends would hide a deletion, and one that replaces would drop a
    // message that arrived while the fetch was in flight.
    onReconnect: async () => reloadChatsRef.current?.(),
  });
  // Signed attachment URLs last an hour; keep them alive in a long-lived tab.
  // Attachments live in their own hook: uploading, rolling back a half-sent album and keeping
  // files that failed on the "try again" shelf is one decision, not four spread through the
  // composer.
  const {
    uploadProgress,
    setUploadProgress,
    failedUploads,
    fileInputRef,
    handleAttachment,
    dismissFailedUpload,
    retryFailedUpload,
    sendVoiceMessage,
  } = useAttachmentSender({
    accountId: accountId ?? null,
    profileName,
    activeChatId: activeId,
    chats,
    notify: action,
    setChats,
    recordingStartedRef,
    setRecordingSeconds,
  });

  useAttachmentRefresh({ chats, enabled: Boolean(accountId), setChats });
  const {
    call,
    startCall,
    answer: answerCall,
    hangUp,
    media: callMedia,
    attachRemoteVideo,
    attachRemoteScreen,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    callError,
    startCallNow,
  } = useCallController({ accountId: accountId ?? null, activeChat, notify: action });

  // Hold the scroll while a chat is showing its unread divider. The holder is
  // cleared as soon as the message count changes, so a new message still pulls
  // the view down.
  // Non-null while the opened chat has unread messages the reader has not reached.
  const unreadHold = unreadMessages(activeChat) ? activeChat.id : null;
  useAutoScroll(messagesListRef, [activeId, activeChat.messages.length], unreadHold);

  const {
    deletedMessage,
    setDeletedMessage,
    forwardMessage,
    deleteMessage,
    deleteMessageLocal,
    undoDelete,
    applyMessageEffect,
    copyMessage,
    startEditing,
  } = useMessageActions({
    accountId: accountId ?? null,
    profileName,
    activeId,
    chats,
    setChats,
    notify: action,
    setOpenMessageActionsId,
  });

  const [stickerOpen, setStickerOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const {
    editingMessageId,
    setEditingMessageId,
    editDraft,
    setEditDraft,
    sendMessage,
    sendSticker,
    scheduleMessage,
    clearComposer,

  } = useComposer({
    accountId: accountId ?? null,
    profileName,
    activeId,
    chats,
    setChats,
    notify: action,
    draft,
    setDraft,
    setDrafts,
    replyTarget,
    replyDrafts,
    setReplyDrafts,
    setReplyTarget,
    queueText,
    setStickerOpen,
    setScheduleOpen,
  });

  const { loadOlder, loadingChatIds } = useHistoryPagination({ accountId, profileName, notify: action, setChats });
  useInfiniteHistory(messagesAreaRef, activeChat, loadOlder);
  // Notification preferences live per device, and the permission state is read
  // once so the settings screen can say plainly whether the browser allows them.
  const { prefs: notificationPrefs, setPrefs: setNotificationPrefs } = useNotificationPrefs();
  // What this browser draws about read receipts and last-seen. Kept beside the notification
  // preferences because both describe the device rather than the account.
  const { prefs: privacyPrefs, setPrefs: setPrivacyPrefs } = usePrivacyPrefs();
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
    const text = chatAsText(chat);
    downloadText(exportFileName(chat.name, Date.now(), "txt"), text, "text/plain;charset=utf-8");
    action(`Переписка выгружена: ${pluralFor(chatAsTextCount(chat))}`);
  }

  /**
   * The whole account in one file.
   *
   * Different from `exportChat` in what it promises: this is what a person takes away on the
   * way out, so it asks each part of the app for its data instead of listing them here. A new
   * kind of data missing from the archive would be a silent loss, which is the one failure a
   * backup cannot afford.
   */
  /**
   * Sends a file that failed earlier, without asking for it again.
   *
   * The file is taken off the shelf before the attempt starts: if it fails again the upload
   * path puts it back, so a repeated failure does not leave two copies of the same entry.
   */


  function exportEverything() {
    const archive = buildAccountArchive({
      profileName,
      chats,
      privacy: privacyPrefs,
      notifications: notificationPrefs,
      folders,
    });
    downloadText(archiveName(), archive.text, "application/json;charset=utf-8");
    action(`Архив выгружен: ${archive.summary}, ${Math.round(archive.text.length / 1024)} КБ`);
  }

  const goBackToChats = useCallback(() => {
    if (mobileView !== "chat") return;
    setMobileView("list");
    setOpenedChatId(null);
    if (window.history.state?.nexusChat) window.history.back();
  }, [mobileView]);
  useBackSwipe({ enabled: mobileView === "chat", onBack: goBackToChats });
  useEffect(() => {
    const onVisibility = () => setDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
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
    const existing = findDirectChatByPeer(chats, user.id);
    if (existing) {
      selectChat(existing);
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
    const known = chats.find((chat) => chat.remoteId === remoteId);
    if (known) {
      setChats((current) => updateChat(current, known.id, (chat) => ({ ...chat, peerId: user.id, avatarPath: user.avatar_path ?? null })));
      selectChat(known);
      setSearch("");
      return;
    }
    const created = directChatFromSearch(remoteId, user, profileName);
    const localId = created.id;
    setChats((current) => (current.some((chat) => chat.remoteId === remoteId) ? current : [created, ...current]));
    setActiveId(localId);
    setMobileView("chat");
    setOpenedChatId(localId);
    setSearch("");
    setDraft("");
    setActiveNav("Чаты");
    action(`Диалог с @${user.username} создан`);
  }

  /**
   * Uploads one picture and returns what the message will carry for it.
   *
   * Shared by single pictures and albums so a photo looks and costs the same either way; the
   * compression and the size rules are not worth having in two places.
   */


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

  /**
   * Sends a game invitation into the open chat.
   *
   * It goes through the draft and the ordinary send path on purpose: an invitation that took a
   * second code path would be the one message that does not get delivery state, retries or the
   * limit check.
   */
  async function sendGameInvitation(kind: GameKind) {
    if (!activeChat) return;
    // The names that go into the invitation are the ones the chat already shows.
    const from = "Вы";
    const to = activeChat.name;
    setDraft(encodeInvitation({ kind, from, to, gameId: null }));
    action("Приглашение готово — отправьте его сообщением.");
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

  // The drafts as they are right now, not as they were when the handler was created. Reading
  // the state directly here was the bug: the box kept the previous chat's text because the
  // handler looked at a copy of the map from before the typing.
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  // The draft for the chat that opens on load, which selectChat would have filled if the
  // user had chosen it. Without this the text is stored and never shown.
  //
  // Choosing a chat clears or restores the box itself, so this must only fill in the case
  // it was written for: the chat that opens without being chosen. It used to run on every
  // change of activeId and do nothing when the new chat had no draft, which left the
  // previous chat's text sitting in the box.
  const restoredDraftFor = useRef<number | null>(null);
  useEffect(() => {
    if (restoredDraftFor.current === activeId) return;
    restoredDraftFor.current = activeId;
    setDraft(drafts[activeId] ?? "");
  }, [activeId, drafts]);

  async function selectChat(chat: Chat) {
    setActiveId(chat.id);
    setOpenedChatId(chat.id);
    setMobileView("chat");
    if (window.matchMedia("(max-width: 760px)").matches) window.history.pushState({ nexusChat: chat.id }, "");
    setDraft(draftsRef.current[chat.id] ?? "");
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

  /**
   * Deletes the conversation itself, not its messages.
   *
   * `clearHistory` empties a chat and keeps the row. Someone who wants the conversation
   * gone had no way to do it, so this leaves the list too. In the cloud the membership is
   * removed for this account and the chat is deleted only when nobody else is in it -
   * deleting a shared conversation for everybody would be a different, louder promise.
   */
  async function deleteChat(chat: Chat) {
    if (!window.confirm(`Удалить чат «${chat.name}» целиком? Переписка исчезнет из списка.`)) return;
    const client = supabase;
    if (client && accountId && chat.remoteId) {
      const { error: leaveError } = await client
        .from("chat_members")
        .delete()
        .eq("chat_id", chat.remoteId)
        .eq("user_id", accountId);
      if (leaveError) {
        action("Не удалось удалить чат в облаке");
        return;
      }
      // Only an empty room is removed from the server; a shared one keeps its history for
      // the people still in it.
      const { count, error: countError } = await client
        .from("chat_members")
        .select("user_id", { count: "exact", head: true })
        .eq("chat_id", chat.remoteId);
      if (!countError && count === 0) {
        await client.from("chats").delete().eq("id", chat.remoteId);
      }
    }
    setChats((current) => {
      const result = removeChat(current, chat.id, activeId);
      if (result.nextActiveId !== null) setActiveId(result.nextActiveId);
      return result.chats;
    });
    setDrafts((current) => {
      const next = { ...current };
      delete next[chat.id];
      return next;
    });
    setDeletedMessage(null);
    setChatMenuOpen(false);
    goBackToChats();
    action(`Чат «${chat.name}» удалён`);
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


  function replyToMessage(message: Message) {
    setReplyTarget(message);
    setReplyDrafts((current) => ({ ...current, [activeId]: { author: message.author, text: message.text } }));
    setOpenMessageActionsId(null);
  }

  /** Sends the message into the open chat with a marker naming the original author. */
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

  return {
    about,
    accountId,
    action,
    activeChat,
    activeFolderId,
    activeGame,
    activeId,
    activeNav,
    addEmoji,
    answerCall,    applyMessageEffect,
    applyMute,
    askForNotifications,
    attachRemoteScreen,
    attachRemoteVideo,
    attachmentBytes,
    attachmentCount,
    autoloadMedia,
    avatarUploading,    blockedEntries,
    cacheKeys,
    call,
    callError,
    callMedia,
    changeDraft,
    changeMemberRole,
    changePrivacy,
    changeVisibility,
    chatFilter,
    chatMembers,
    chatMenuOpen,
    chats,    chooseMention,
    clearCache,
    clearHistory,
    deleteChat,
    clearNotice,
    clearingCache,
    confirmDeleteAccount,
    copyMessage,
    createChat,
    createFolder,
    createInviteLink,
    createPoll,
    deleteFolder,
    deleteMessage,
    deleteMessageLocal,
    deletedMessage,
    deletingAccount,
    deviceId,
    devices,
    draft,    editDraft,
    editingMessageId,
    emojiOpen,
    stickerOpen,
    scheduleOpen,
    exportChat,
    exportEverything,
    failedUploads,
    retryFailedUpload,
    dismissFailedUpload,
    fileInputRef,
    folderChats,
    folderPickerChat,
    folders,
    forwardMessage,
    foundUsers,
    galleryImages,
    galleryOpen,    goBackToChats,
    handleAttachment,
    hangUp,
    kickMember,
    language,
    leaveGroup,
    loadOlder,
    loadingChatIds,
    lockCode,
    lockUnlocked,
    mediaPolicy,
    mentionMatches,
    mentionOpen,
    messageSearch,
    messageSearchOpen,
    messagesAreaRef,
    messagesEndRef,
    messagesListRef,
    mobileView,
    moveChatFolder,
    muteChatId,
    myChatRole,
    newChatIsGroup,
    newChatName,
    newChatOpen,
    noteOpen,
    notice,
    notificationPermission,
    notificationPrefs,
    privacyPrefs,
    openDirectChat,
    openGame,
    openMessageActionsId,
    openSearchHit,
    openingUserId,
    peerLastSeenAt,
    peerOnline,
    pinnedMessageIds,    pollOpen,
    pollOptions,
    pollQuestion,
    privacy,
    privacyOpen,
    privacySaving,
    profileAvatar,
    profileName,
    profileOpen,
    recording,
    recordingSeconds,
    removeAvatar,
    renameChatFolder,
    replyTarget,
    replyToMessage,
    revealMessageId,
    rotateInviteLink,
    saveAbout,
    saveChatSettings,
    saveToFavourites,
    saveUsername,
    search,
    searchAuthor,
    searchTime,
    selectChat,
    selfAvatarUrl,
    sendMessage,
    sendGameInvitation,
    retryMessage,
    sendSticker,
    scheduleMessage,
    serverSearch,
    setActiveFolderId,
    setActiveGame,
    setActiveId,
    setActiveNav,    setChatFilter,
    setChatMenuOpen,
    setCode,
    setDeletedMessage,
    setEditDraft,
    setEditingMessageId,
    setEmojiOpen,
    setStickerOpen,
    setScheduleOpen,
    setFolderPickerChat,
    setGalleryOpen,
    setLanguage,
    setMediaPolicy,
    setMessageSearch,
    setMessageSearchOpen,
    setMobileView,
    setMuteChatId,
    setNewChatIsGroup,
    setNewChatName,
    setNewChatOpen,
    setNoteOpen,
    setNotificationPrefs,
    setOpenMessageActionsId,
    setPollOpen,
    setPrivacyPrefs,
    setPollOptions,
    setPollQuestion,
    setPrivacyOpen,
    setProfileAvatar,
    setProfileName,
    setProfileOpen,
    setReplyDrafts,
    setReplyTarget,
    setRevealMessageId,
    setSearch,
    setShortcutsOpen,
    setShowProfile,
    setTextSize,
    setTheme,
    setUsername,
    setWallpaper,
    shortcutsOpen,
    showProfile,
    signOutOtherDevices,
    signingOutOthers,
    startCallNow,
    startEditing,
    startVoiceRecording,    t,
    textSize,
    theme,
    toggleCamera,
    toggleChatFolder,
    toggleChatPin,
    toggleMute,
    toggleNotifications,
    togglePinnedMessage,
    toggleReaction,
    toggleScreenShare,
    twoFactor,
    typingUsers,
    unblockPerson,
    undoDelete,
    unlock,    unreadTotal,
    uploadAvatar,
    uploadProgress,
    userSearchLoading,
    username,
    usernameSaving,
    visibility,
    visibleMessages,
    votePoll,
    wallpaper,
    wideLayout,
  };
}
