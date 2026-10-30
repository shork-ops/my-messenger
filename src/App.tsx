/**
 * The messenger shell.
 *
 * The state, effects and handlers live in useMessenger; this file is the layout, and
 * nothing else. It was two thousand lines of both, which made every change a change to
 * three things at once.
 */
import PasscodeLock from "./components/PasscodeLock";
import Rail from "./components/Rail";
import ChatListPanel from "./components/ChatListPanel";
import ConversationPanel from "./components/ConversationPanel";
import RightPanel from "./components/RightPanel";
import GameModal from "./components/GameModal";
import PrivacyModal from "./components/PrivacyModal";
import SettingsModal from "./components/SettingsModal";
import type { ChangeEvent } from "react";
import { Shield, X } from "lucide-react";
import { GalleryModal, MuteModal, NewChatModal, PollModal } from "./components/Modals";
import FolderPicker from "./components/FolderPicker";
import EmojiPicker from "./components/EmojiPicker";
import VideoNoteRecorder from "./components/VideoNoteRecorder";
import { formatNoteTime } from "./lib/videoNote";
import { isDemoMode } from "./lib/constants";
import { useMessenger } from "./hooks/useMessenger";
import "./styles.css";
import { CallOverlay } from "./components/CallOverlay";
import ShortcutHelp from "./components/ShortcutHelp";

export default function App() {
  const {
    about,
    accountId,
    action,
    activeChat,
    activeFolderId,
    activeGame,
    activeId,
    activeNav,
    addEmoji,
    answerCall,
    answerChess,
    applyMessageEffect,
    applyMute,
    askForNotifications,
    attachRemoteScreen,
    attachRemoteVideo,
    attachmentBytes,
    attachmentCount,
    autoloadMedia,
    avatarUploading,
    baldaInput,
    baldaScore,
    baldaWords,
    blockedEntries,
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
    chats,
    chessSolved,
    chooseMention,
    clearCache,
    clearHistory,
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
    draft,
    drawUnoCard,
    editDraft,
    editingMessageId,
    emojiOpen,
    exportChat,
    fileInputRef,
    folderChats,
    folderPickerChat,
    folders,
    forwardMessage,
    foundUsers,
    galleryImages,
    galleryOpen,
    gameNotice,
    goBackToChats,
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
    openDirectChat,
    openGame,
    openMessageActionsId,
    openSearchHit,
    openingUserId,
    peerLastSeenAt,
    peerOnline,
    pinnedMessageIds,
    playUnoCard,
    pollOpen,
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
    serverSearch,
    setActiveFolderId,
    setActiveGame,
    setActiveId,
    setActiveNav,
    setBaldaInput,
    setChatFilter,
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
    startVoiceRecording,
    submitBaldaWord,
    t,
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
    unlock,
    unoHand,
    unoTop,
    unreadTotal,
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
  } = useMessenger();

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
        onRemoteScreen={attachRemoteScreen}
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

