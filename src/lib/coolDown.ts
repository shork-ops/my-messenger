/**
 * «Анти-ссора»: a pause before a message that is shouted.
 *
 * Capitals read as a raised voice. In a calm conversation one or two of them are emphasis or
 * an abbreviation - «США», «ОК», «ВАЖНО» - and stepping in there would be a nag. The line is
 * deliberately simple and countable: more than three words written entirely in capitals.
 * Single letters do not count, because «Я» and «I» at the start of a sentence are not shouting.
 *
 * This file is on the first screen, because the composer asks it on every send. It is kept to
 * the question alone; softening the text and measuring its "temperature" live next to the
 * sheet that shows them, in a chunk that is loaded only when someone actually shouts.
 */

import { readItem, writeItem } from "./safeStorage";

/** More than this many words in capitals, and the sheet is offered. */
export const COOL_DOWN_THRESHOLD = 3;

const PREF_KEY = "nexus.coolDown";

/**
 * What is not prose and must never be judged or changed: code, links, @mentions.
 * `HTTP`, `GET /API/V1` or `@IVAN_PETROV` are not anyone raising their voice.
 */
export const PROTECTED = /```[\s\S]*?```|`[^`\n]+`|\bhttps?:\/\/\S+|\bwww\.\S+|@[\p{L}\p{N}_.]+/gu;

const WORD = /\p{L}+/gu;

/** The text with code, links and mentions replaced by spaces. */
export function prose(text: string): string {
  return text.replace(PROTECTED, " ");
}

/** A word of two letters or more with every letter a capital. Scripts without case never count. */
export function isCapsWord(word: string): boolean {
  return word.length >= 2 && word === word.toUpperCase() && word !== word.toLowerCase();
}

/** How many words are written in capitals. */
export function capsWords(text: string): number {
  let count = 0;
  for (const match of prose(text).matchAll(WORD)) if (isCapsWord(match[0])) count += 1;
  return count;
}

/** Whether this text is shouted: more than three words in capitals. */
export function isHeated(text: string): boolean {
  return capsWords(text) > COOL_DOWN_THRESHOLD;
}

/** On unless the person said no. */
export function coolDownEnabled(): boolean {
  return readItem(PREF_KEY) !== "off";
}

export function setCoolDownEnabled(enabled: boolean): void {
  writeItem(PREF_KEY, enabled ? "on" : "off");
}

/**
 * Whether to step in before this send.
 *
 * A channel is a broadcast with nobody to argue with, and Favourites is a note to oneself;
 * the pause belongs in conversations only.
 */
export function shouldCoolDown(text: string, chat: { id: number; channel?: boolean }, favouritesId: number): boolean {
  if (chat.channel || chat.id === favouritesId) return false;
  if (!coolDownEnabled()) return false;
  return isHeated(text);
}
