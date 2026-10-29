import type { Message } from "../types";

/**
 * Puts a just-sent message where the server says it belongs.
 *
 * The order of a conversation is the server's `created_at`, not the order messages
 * happened to arrive on this device. Two people talking from clocks a few seconds
 * apart would otherwise see the same exchange in different orders, and a message could
 * jump when the page reloads and the timestamps are read back from the server.
 */
export function placeNewMessage(messages: Message[], fresh: Message): Message[] {
  const freshAt = fresh.createdAt;
  // A message with no timestamp has nowhere better to go than the end.
  if (freshAt === undefined) return [...messages, fresh];

  // The common case: the new message is the newest, so nothing needs searching. A tie
  // still has to be resolved, because it is common when the server echoes a message back.
  const newest = messages[messages.length - 1];
  if (!newest || newest.createdAt === undefined) return [...messages, fresh];
  if (freshAt > newest.createdAt) return [...messages, fresh];
  if (freshAt === newest.createdAt && fresh.id > newest.id) return [...messages, fresh];

  const index = messages.findIndex((message) => {
    if (message.createdAt === undefined) return false;
    if (message.createdAt !== freshAt) return message.createdAt > freshAt;
    // Same millisecond: the id decides, so the result does not depend on arrival order.
    return message.id > fresh.id;
  });
  const at = index < 0 ? messages.length : index;
  return [...messages.slice(0, at), fresh, ...messages.slice(at)];
}
