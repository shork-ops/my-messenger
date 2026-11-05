/**
 * The messenger shell.
 *
 * The state, effects and handlers live in useMessenger; this file is the layout, and
 * nothing else. It was two thousand lines of both, which made every change a change to
 * three things at once.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Shield, X } from "lucide-react";
import PasscodeLock from "./components/PasscodeLock";
import Rail from "./components/Rail";
import ConnectionStatus from "./components/ConnectionStatus";
import ChatListPanel from "./components/ChatListPanel";
import ConversationPanel from "./components/ConversationPanel";
import RightPanel from "./components/RightPanel";
import type { SettingsSectionId } from "./components/SettingsModal";
import { noteAttachmentName } from "./lib/videoNoteKind";
import { useStreaks } from "./hooks/useStreaks";
import { isDemoMode } from "./lib/constants";
import { useMessenger } from "./hooks/useMessenger";
import { useCallRecording } from "./hooks/useCallRecording";
import { useAccounts } from "./hooks/useAccounts";
import { pendingForChat } from "./lib/retryQueue";
import { setCoolDownEnabled, shouldCoolDown } from "./lib/coolDown";
import { FAVOURITES_CHAT_ID } from "./lib/messageActions";
import { atHour } from "./lib/scheduling";
import "./styles.css";
import { useMobileViewport } from "./hooks/useMobileViewport";

// Everything below opens on a press: settings, a game, a call, the camera, a dialog.
// Each is its own chunk, so the first screen does not download what it may never open.
// `Modals` exports four dialogs from one file and keeps one chunk between them.
const GameModal = lazy(() => import("./components/GameModal"));
const PrivacyModal = lazy(() => import("./components/PrivacyModal"));
const ReportModal = lazy(() => import("./components/ReportModal"));
const SettingsModal = lazy(() => import("./components/SettingsModal"));
const VideoNoteRecorder = lazy(() => import("./components/VideoNoteRecorder"));
const ShortcutHelp = lazy(() => import("./components/ShortcutHelp"));
const CallOverlay = lazy(() => import("./components/CallOverlay").then((m) => ({ default: m.CallOverlay })));
const GalleryModal = lazy(() => import("./components/Modals").then((m) => ({ default: m.GalleryModal })));
const MuteModal = lazy(() => import("./components/Modals").then((m) => ({ default: m.MuteModal })));
const DisappearingModal = lazy(() => import("./components/Modals").then((m) => ({ default: m.DisappearingModal })));
const NewChatModal = lazy(() => import("./components/Modals").then((m) => ({ default: m.NewChatModal })));
const PollModal = lazy(() => import("./components/Modals").then((m) => ({ default: m.PollModal })));
const StreakCard = lazy(() => import("./components/StreakCard"));
// The pickers open on a press too; the emoji and sticker lists stay in their own chunks.
const FolderPicker = lazy(() => import("./components/FolderPicker"));
const EmojiPicker = lazy(() => import("./components/EmojiPicker"));
const StickerPicker = lazy(() => import("./components/StickerPicker"));
const ScheduleModal = lazy(() => import("./components/ScheduleModal"));
// Seen once per account, on its first visit; never in demo mode.
const WelcomeModal = lazy(() => import("./components/WelcomeModal"));
// «Анти-ссора»: only someone who shouts downloads it.
const CoolDownSheet = lazy(() => import("./components/CoolDownSheet"));

export default function App() {
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | null>(null);
  // The complaint dialog needs the chat and message ids from the server, not the local ones:
  // only a stored message can be pointed at. Kept here because it outlives one bubble.
  const [reportTarget, setReportTarget] = useState<{ chatId: string; messageId: string | null } | null>(null);
  // Which chat the gallery shows when opened from the chat panel; null is every chat.
  const [galleryScope, setGalleryScope] = useState<string | null>(null);
  // «Огонёк дружбы» card for the open chat.
  const [streakOpen, setStreakOpen] = useState(false);
  // The message a reaction is being picked for in the full emoji picker.
  const [reactionPickFor, setReactionPickFor] = useState<number | null>(null);
  // The shouted draft the «Анти-ссора» sheet is open for, and the softened text it put back:
  // sending that one does not ask again, even if an abbreviation or two kept it "heated".
  const [coolDownText, setCoolDownText] = useState<string | null>(null);
  const cooledDraft = useRef<string | null>(null);
  const {
    dataLoadError, dataLoading, retryDataLoad,
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
    applyDisappearing,
    closeDisappearing,
    disappearingChatId,
    openDisappearing,
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
    setScheduleOpen,
    setStickerOpen,
    exportChat,
    exportEverything,
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
    setPrivacyPrefs,
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
    hiddenNext,
    setHiddenNext,
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
    failedUploads,
    retryFailedUpload,
    dismissFailedUpload,
    userSearchLoading,
    username,
    usernameSaving,
    visibility,
    visibleMessages,
    votePoll,
    wallpaper,
    wideLayout,
    welcomeOpen,
    finishWelcome,
  } = useMessenger();

  // Recording belongs to the call surface, but the chat name - which names the saved file - is
  // known here. The accounts list describes this browser, so it lives beside the call.
  useMobileViewport();
  /**
   * The composer's send, with one stop before it: a draft with more than three words in
   * capitals opens «Анти-ссора» instead of leaving. Edits are not asked about - the message
   * is already out, and an edit that removes the shouting is the thing to encourage.
   */
  function submitComposer(event: FormEvent) {
    const text = draft.trim();
    if (editingMessageId === null && text && text !== cooledDraft.current && shouldCoolDown(text, activeChat, FAVOURITES_CHAT_ID)) {
      event.preventDefault();
      setCoolDownText(text);
      return;
    }
    cooledDraft.current = null;
    void sendMessage(event);
  }

  function closeCoolDown() {
    setCoolDownText(null);
    // Back to the text, where the person was typing.
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(), 0);
  }

  // A file that failed in one conversation is not offered in another.
  const pendingUploadsForChat = pendingForChat(failedUploads, activeChat.id);
  const callRecording = useCallRecording(activeChat.name);
  const accounts = useAccounts();
  const { streaks, burstId } = useStreaks(chats, accountId, action);
  const activeStreak = streaks.get(activeChat.id);

  // The list of accounts is filled from the session that is actually signed in, not from
  // whatever the switcher believes: a slot with no session behind it is a row that does
  // nothing when pressed. Demo mode has no session, so it writes nothing.
  const rememberedSlot = useRef<string | null>(null);
  useEffect(() => {
    if (!accountId || !accounts.ready || accounts.switching) return;
    if (rememberedSlot.current === accounts.activeSlot) return;
    rememberedSlot.current = accounts.activeSlot;
    accounts.remember({ name: profileName || "Аккаунт", email: null });
  }, [accountId, accounts, profileName]);

  if (lockCode && !lockUnlocked) {
    return <PasscodeLock passcode={lockCode} onUnlock={unlock} />;
  }

  return (
    <main className={`app-shell ${mobileView === "chat" ? "mobile-chat" : "mobile-list"}`}>
      <ConnectionStatus loadError={dataLoadError} loading={dataLoading} onRetry={retryDataLoad} />
      <header className="mobile-list-header">
        <strong><span>N</span> Nexus</strong>
        <button type="button" onClick={() => { setSettingsSection("profile"); setProfileOpen(true); }} aria-label="Мой профиль">{profileName || "Мой профиль"}</button>
      </header>
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
          setSettingsSection(null);
          setProfileOpen(true);
        }}
        onOpenGames={() => {
          setActiveNav("Мини-игры");
          openGame("Каталог");
        }}
        onOpenProfile={() => {
          // The avatar promises the profile, so it goes straight there.
          setSettingsSection("profile");
          setProfileOpen(true);
        }}
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
        streaks={streaks}
        onSelectChat={selectChat}
        onTogglePin={toggleChatPin}
        onMuteChat={(chat) => {
          if (chat.mutedUntil && chat.mutedUntil > Date.now()) {
            void saveChatSettings(chat.id, { mutedUntil: null }).then((ok) => ok && action("Звук включён"));
          } else setMuteChatId(chat.id);
        }}
        onArchiveChat={(chat) => {
          const next = !chat.archived;
          void saveChatSettings(chat.id, { archived: next }).then((ok) => ok && action(next ? "Чат в архиве" : "Чат возвращён из архива"));
        }}
        onPickFolders={(chat) => setFolderPickerChat(chat)}
        onDeleteChat={(chat) => void deleteChat(chat)}
      />

      <ConversationPanel
        chat={activeChat}
        onBack={goBackToChats}
        isDemoMode={isDemoMode}
        privacy={privacyPrefs}
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
          void exportChat(activeChat);
        }}
        onFolders={() => {
          setChatMenuOpen(false);
          setFolderPickerChat(activeChat);
        }}
        onClearHistory={() => {
          setChatMenuOpen(false);
          clearHistory();
        }}
        onDeleteChat={() => {
          setChatMenuOpen(false);
          void deleteChat(activeChat);
        }}
        onMute={() => {
          setChatMenuOpen(false);
          setMuteChatId(activeChat.id);
        }}
        onDisappearing={() => {
          setChatMenuOpen(false);
          openDisappearing(activeChat.id);
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
        onMoreReactions={(messageId) => {
          setOpenMessageActionsId(null);
          setReactionPickFor(messageId);
        }}
        onRetry={retryMessage}
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
        onGameInvite={() => setActiveGame("Каталог")}
        onReportMessage={(chatRemoteId, messageRemoteId) => {
          if (!chatRemoteId) {
            action("Разговор ещё не сохранён на сервере — пожаловаться пока нельзя");
            return;
          }
          setReportTarget({ chatId: chatRemoteId, messageId: messageRemoteId });
        }}
        typingNames={typingUsers.map((user) => user.name)}
        uploadProgress={uploadProgress}
        failedUploads={pendingUploadsForChat}
        onRetryUpload={retryFailedUpload}
        onDismissUpload={dismissFailedUpload}
        peerOnline={peerOnline}
        peerLastSeenAt={peerLastSeenAt}
        streak={activeStreak}
        streakBurst={burstId === activeChat.id}
        onOpenStreak={() => setStreakOpen(true)}
        endRef={messagesEndRef}
        listRef={messagesListRef}
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
  onStickers: () => setStickerOpen((open) => !open),
  onSchedule: () => setScheduleOpen(true),
          onVideoNote: () => setNoteOpen(true),
          onToggleVoice: () => void startVoiceRecording(),
          onSubmit: submitComposer,
        onGameInvite: (kind: "chess" | "cards" | "balda") => void sendGameInvitation(kind),
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
          onViewOnce: () => {
            // The same file picker, with the flag the sender chose. A separate input would
            // duplicate the accept list and the change handler, and they would drift.
            const input = fileInputRef.current;
            if (!input) return;
            input.dataset.viewOnce = "true";
            input.click();
          },
          onOpenGallery: () => setGalleryOpen(true),
          onOpenPoll: () => setPollOpen(true),
          hidden: hiddenNext,
          onToggleHidden: () => setHiddenNext((on) => !on),
        }}
      />

      {/* Every dialog in this block is a separate chunk. One Suspense boundary covers the
          lot: while a chunk loads the rest of the app keeps its state, and a null fallback
          means a dialog that has not arrived yet looks like a closed dialog, which is what
          it is. */}
      <Suspense fallback={null}>
      {shortcutsOpen && <ShortcutHelp onClose={() => setShortcutsOpen(false)} />}

      {streakOpen && activeStreak && (
        <StreakCard chatName={activeChat.name} streak={activeStreak.streak} onClose={() => setStreakOpen(false)} />
      )}

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
            const named = new File([file], noteAttachmentName(durationMs, file.type), { type: file.type });
            const transfer = new DataTransfer();
            transfer.items.add(named);
            input.files = transfer.files;
            // Marked as a note, so it is drawn as a circle on both sides, not as a video file.
            void handleAttachment({ target: input } as unknown as ChangeEvent<HTMLInputElement>, { videoNoteMs: durationMs });
          }}
          onClose={() => setNoteOpen(false)}
        />
      )}

      {coolDownText !== null && (
        <CoolDownSheet
          text={coolDownText}
          morning={activeChat.remoteId ? atHour(new Date(), 9) : null}
          onCool={(cooled, degrees) => {
            changeDraft(cooled);
            cooledDraft.current = cooled.trim();
            closeCoolDown();
            action(`Остыло до ${degrees} 🧊 Проверьте и отправьте`);
          }}
          onSendAnyway={() => {
            setCoolDownText(null);
            void sendMessage({ preventDefault() {} } as FormEvent);
          }}
          onMorning={(at) => {
            setCoolDownText(null);
            void scheduleMessage(at);
          }}
          onDisable={() => {
            setCoolDownEnabled(false);
            closeCoolDown();
            action("«Анти-ссора» выключена. Вернуть: Настройки → Оформление");
          }}
          onClose={closeCoolDown}
        />
      )}

      {scheduleOpen && (
        <ScheduleModal text={draft} onPick={(at) => void scheduleMessage(at)} onClose={() => setScheduleOpen(false)} />
      )}

      {stickerOpen && (
        <StickerPicker
          onPick={(stickerId) => sendSticker(stickerId)}
          onClose={() => setStickerOpen(false)}
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

      {reactionPickFor !== null && (
        <EmojiPicker
          onPick={(char) => {
            void toggleReaction(reactionPickFor, char);
            setReactionPickFor(null);
          }}
          onClose={() => setReactionPickFor(null)}
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
          onOpenProfile={() => {
          setSettingsSection("profile");
          setProfileOpen(true);
        }}
          onCreateInvite={() => void createInviteLink()}
          onRotateInvite={() => void rotateInviteLink()}
          onChangeRole={(userId, role) => void changeMemberRole(userId, role)}
          onRemoveMember={(userId) => void kickMember(userId)}
          onLeaveGroup={() => void leaveGroup()}
          onOpenGallery={() => {
            setGalleryScope(activeChat.name);
            setGalleryOpen(true);
          }}
          autoloadMedia={autoloadMedia}
        />
      )}

      {reportTarget && (
        <Suspense fallback={null}>
          <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />
        </Suspense>
      )}

      {/* The game screen owns its own sessions; the app only decides whether it is on screen. */}
      {activeGame && <GameModal open onClose={() => setActiveGame(null)} />}

      {/* Mounted only while open: a lazy component starts downloading on its first
          render, so keeping it mounted with open={false} would fetch it anyway. */}
      {newChatOpen && (
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
      )}

      {muteChatId !== null && (
      <MuteModal
          open={muteChatId !== null}
          chatName={chats.find((chat) => chat.id === muteChatId)?.name ?? ""}
          onPick={(optionId) => void applyMute(optionId)}
          onClose={() => setMuteChatId(null)}
        />
      )}

      {disappearingChatId === activeChat.id && (
        <DisappearingModal
          chat={activeChat}
          role={myChatRole}
          onPick={(seconds) => void applyDisappearing(seconds)}
          onClose={closeDisappearing}
        />
      )}

      {pollOpen && (
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
      )}

      {galleryOpen && (
      <GalleryModal
          open={galleryOpen}
          images={galleryScope === null ? galleryImages : galleryImages.filter((image) => image.chatName === galleryScope)}
          onClose={() => {
            setGalleryOpen(false);
            setGalleryScope(null);
          }}
          onOpenImage={(image) => {
            setActiveId(chats.find((chat) => chat.name === image.chatName)?.id ?? activeId);
            setGalleryOpen(false);
            setGalleryScope(null);
          }}
        />
      )}

      {Boolean(call) && (
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
          onRemoteScreen={attachRemoteScreen}
          participants={callMedia.participants}
          recording={{
            active: callRecording.recording,
            seconds: callRecording.seconds,
            error: callRecording.error,
            unsupported: callRecording.unsupported,
            onStart: () => void callRecording.start(),
            onStop: callRecording.stop,
          }}
        />
      )}

      {privacyOpen && (
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
          onExportAll={exportEverything}
          onClose={() => setPrivacyOpen(false)}
        />
      )}

      {profileOpen && (
      <SettingsModal
          open={profileOpen}
          initialSection={settingsSection}
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
          onClose={() => {
            setProfileOpen(false);
            setSettingsSection(null);
          }}
          onNameChange={setProfileName}
          onAvatarChange={setProfileAvatar}
          onUsernameChange={setUsername}
          onSaveUsername={() => void saveUsername()}
          onThemeChange={setTheme}
          onOpenPrivacy={() => setPrivacyOpen(true)}
          prefs={notificationPrefs}
        privacy={privacyPrefs}
        onPrivacyChange={setPrivacyPrefs}
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
        savedAccounts={accounts.saved}
        activeAccountSlot={accounts.activeSlot}
        onSwitchAccount={accounts.switchTo}
        onAddAccount={() => {
          if (!accounts.startNew()) action("Больше четырёх аккаунтов на одном устройстве не поддерживается");
        }}
        onForgetAccount={accounts.forget}
        accountsSwitching={accounts.switching}
        />
      )}

      {welcomeOpen && (
        <WelcomeModal
          name={profileName}
          username={username}
          photoUrl={selfAvatarUrl}
          uploading={avatarUploading}
          saving={usernameSaving}
          onNameChange={setProfileName}
          onUsernameChange={setUsername}
          onPhoto={(file) => void uploadAvatar(file)}
          onSaveUsername={saveUsername}
          onFinish={finishWelcome}
        />
      )}
      </Suspense>

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

