export type MessageEffect =
  | "sparkle"
  | "hearts"
  | "fireworks"
  | "glow"
  | "confetti"
  | "snow"
  | "fire"
  | "rainbow"
  | "bounce"
  | "shadow";

export type PollOption = { id: string; text: string; votes: string[] };

export type Poll = { question: string; options: PollOption[] };

export type Attachment = {
  name: string;
  type: string;
  data: string;
  size: number;
  path?: string;
  /** Inline preview data URL, so the bubble paints before the file loads. */
  thumbnail?: string;
  width?: number;
  height?: number;
  /** Length of a voice message in seconds. */
  duration?: number;
  /** Quantised peaks (0..255) used to draw the waveform. */
  waveform?: number[];
  /**
   * When the signed `data` URL stops working (epoch ms). Absent for inline
   * data URLs and for local chats, which never expire.
   */
  expiresAt?: number;
};

export type ReplyPreview = { author: string; text: string };

export type Message = {
  id: number;
  remoteId?: string;
  author: string;
  text: string;
  time: string;
  mine?: boolean;
  image?: boolean;
  attachment?: Attachment;
  poll?: Poll;
  edited?: boolean;
  createdAt?: number;
  replyTo?: ReplyPreview;
  reactions?: string[];
  effect?: MessageEffect;
  /**
   * The sticker this message is, by id. A sticker carries no text: the id is the message,
   * and the artwork is drawn from the bundle so it cannot rot behind a dead link.
   */
  stickerId?: string;
  /** Message pinned to the chat header; servers store the timestamp. */
  pinned?: boolean;
};

export type Chat = {
  id: number;
  remoteId?: string;
  name: string;
  avatar: string;
  /** Storage path of the other person's photo in a direct chat; groups have none. */
  avatarPath?: string | null;
  color: string;
  preview: string;
  time: string;
  unread?: number;
  group?: boolean;
  members?: string[];
  inviteCode?: string;
  pinned?: boolean;
  lastReadAt?: number;
  memberReadAt?: Record<string, number>;
  memberLastSeenAt?: Record<string, number>;
  /** True once the server returned a short page, meaning no older history exists. */
  historyExhausted?: boolean;
  /** Notifications are suppressed until this moment; null or past means unmuted. */
  mutedUntil?: number | null;
  /** True when this account moved the chat out of the main list. */
  archived?: boolean;
  messages: Message[];
};

export type UserSearchResult = {
  id: string;
  username: string;
  display_name: string;
  avatar: string;
  avatar_path?: string | null;
};

export type ChatFilter = "all" | "unread" | "pinned" | "groups" | "archive";

export type Profile = { name: string; avatar: string; username: string };

export type ChatMessageRow = {
  id: string;
  chat_id: string;
  sender_id: string;
  body: string;
  poll?: Poll | null;
  attachment?: { name?: string; type?: string; size?: number; path?: string } | null;
  effect?: MessageEffect | null;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
};

export type ChatRow = {
  id: string;
  title: string;
  is_group: boolean;
  invite_code: string | null;
  created_at: string;
};
