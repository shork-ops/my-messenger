import { supabase } from "./supabase";

export async function viewOnceReady(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.functions.invoke("view-once", { body: { action: "ready" } });
    return !error && data?.ready === true;
  } catch { return false; }
}

export async function openViewOnce(messageId: string): Promise<{ url?: string; spent?: boolean; error?: string }> {
  if (!supabase) return { error: "Нет подключения" };
  try {
    const { data, error } = await supabase.functions.invoke("view-once", { body: { messageId } });
    if (error) {
      const response = (error as { context?: Response }).context;
      if (response?.status === 409) return { spent: true };
      return { error: "Фото недоступно. Попробуйте позже; для старого фото может потребоваться повторная отправка." };
    }
    if (!data?.url) return { error: "Не удалось открыть фото" };
    return { url: data.url };
  } catch { return { error: "Проверьте подключение к сети" }; }
}
