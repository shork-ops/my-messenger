export type MessageEffect = "sparkle" | "hearts" | "fireworks" | "glow";

export type PollOption = { id: string; text: string; votes: string[] };

export type Poll = { question: string; options: PollOption[] };

export type Attachment = {
  name: string;
  type: string;
  data: string;
  size: number;
  path?: string;
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
};

export type Chat = {
  id: number;
  remoteId?: string;
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
  lastReadAt?: number;
  memberReadAt?: Record<string, number>;
  messages: Message[];
};

export type UserSearchResult = {
  id: string;
  username: string;
  display_name: string;
  avatar: string;
};

export type ChatFilter = "all" | "unread" | "pinned" | "groups";

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
