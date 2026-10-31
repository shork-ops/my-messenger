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
  /**
   * Media the sender meant to be looked at once. Kept on the attachment rather than in a new
   * table so it travels with the message through every path that already handles attachments.
   */
  viewOnce?: boolean;
  bucket?: "chat-media" | "view-once-media";
};

export type ReplyPreview = { author: string; text: string };

/**
 * One picture of an album. The same shape as a single Attachment, because the first picture
 * of an album and a picture sent alone should not be two different things to render.
 */
export type AlbumItem = Attachment;

export type Message = {
  id: number;
  remoteId?: string;
  delivery?: "sending" | "failed" | "sent";
  author: string;
  text: string;
  time: string;
  mine?: boolean;
  image?: boolean;
  attachment?: Attachment;
  /**
   * Pictures sent together. The message carries the album instead of a single attachment:
   * five rows for five photos would push the conversation down five lines and arrive as
   * five notifications.
   */
  album?: AlbumItem[];
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
  /** When this message is due, for one scheduled ahead. Absent means it is already sent. */
  sendAt?: number;
  /** Message pinned to the chat header; servers store the timestamp. */
  pinned?: boolean;
};

import type { ChannelDesign, ChannelRole } from "./lib/channels";

export type Chat = {
  id: number;
  remoteId?: string;
  peerId?: string;
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
  /**
   * A channel: the owner and its authors write, everyone else reads. Subscribers see no
   * composer at all, because a channel that answers a tap with "you cannot post here" has
   * already asked the wrong question.
   */
  channel?: boolean;
  /** This account's standing in a channel. Absent for ordinary chats. */
  channelRole?: ChannelRole;
  /** Read-only summary of the channel's look, already validated by parseChannelDesign. */
  channelDesign?: ChannelDesign;
  /** What the channel says about itself; shown instead of the subscriber count. */
  description?: string;
  /** The handle a channel can be found and joined by. */
  handle?: string;
  /** Silenced on arrival, as a channel should be: the reader chose to follow, not to be nagged. */
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
