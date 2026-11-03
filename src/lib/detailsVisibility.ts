import type { DetailsVisibility } from "./visibility";

/**
 * The three answers to "who sees my photo and my «О себе»", in the dialog's words.
 *
 * "Contacts" is explained in the hint because the app has no address book: a contact is
 * someone you have written to in a personal chat (see migration 20261057).
 */
export const DETAILS_VISIBILITY: readonly { id: DetailsVisibility; label: string; hint: string }[] = [
  { id: "everyone", label: "Все пользователи", hint: "Фото и «О себе» видят все" },
  { id: "contacts", label: "Мои контакты", hint: "Видят только те, кому вы писали в личных чатах" },
  { id: "nobody", label: "Никто", hint: "Вместо фото другие увидят букву, «О себе» не покажется" },
];
