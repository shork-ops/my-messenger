/**
 * Media auto-download.
 *
 * A photo that loads itself uses the traffic of someone on a metered phone plan; a
 * photo that waits needs a tap every time. The setting is the user's answer to that,
 * and the default has to be the choice that cannot cost money by accident.
 */

export const MEDIA_POLICIES = [
  { id: "wifi", label: "По Wi-Fi", hint: "Картинки грузятся сами в Wi-Fi и ждут тапа в мобильной сети" },
  { id: "always", label: "Всегда", hint: "Картинки грузятся сами всегда" },
  { id: "manual", label: "Вручную", hint: "Картинка появляется после нажатия" },
] as const;

export type MediaPolicy = (typeof MEDIA_POLICIES)[number]["id"];

/** Wi-Fi by default: it is the only value that cannot spend someone's traffic unnoticed. */
export const DEFAULT_MEDIA_POLICY: MediaPolicy = "wifi";

export const MEDIA_POLICY_STORAGE_KEY = "nexus-media-policy";

export function parseMediaPolicy(raw: string | null | undefined): MediaPolicy {
  const found = MEDIA_POLICIES.find((item) => item.id === raw);
  return found ? found.id : DEFAULT_MEDIA_POLICY;
}

/** What the network looks like, as far as the browser will tell us. */
export type NetworkKind = "wifi" | "cellular" | "unknown";

/**
 * Whether a picture should load without a tap.
 *
 * `unknown` counts as Wi-Fi: the browser's Network Information API is not available
 * everywhere, and treating "unknown" as cellular would mean a desktop on a cable
 * modem never showed a picture. The saving comes from the one case the API is sure
 * about.
 */
export function shouldAutoload(policy: MediaPolicy, network: NetworkKind): boolean {
  if (policy === "manual") return false;
  if (policy === "always") return true;
  return network !== "cellular";
}
