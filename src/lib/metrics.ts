/**
 * Whether the application is healthy, measured without reading anyone's messages.
 *
 * The one thing a messenger must never do is collect the content of conversations for
 * "analytics". The one thing it must do is notice when delivery stops working. These two
 * goals are compatible only if the measurements are counts and durations - never text, never
 * names, never identifiers of a chat - and if that rule is enforced by the code rather than
 * remembered by whoever writes the next metric.
 *
 * So a reading here has a fixed, closed shape. There is no place to put a message body, and
 * `assertNoContent` refuses anything that looks like one that slipped in through a field.
 */

/** What can be counted. Adding a name here is a decision about what leaves the device. */
export const METRIC_EVENTS = [
  /** A message was handed to the network and acknowledged. */
  "message_sent",
  /** A send attempt failed. The reason is a short code, not an error message. */
  "message_failed",
  /** A send was retried from the shelf of failed uploads. */
  "message_retried",
  /** The realtime connection dropped and was re-established. */
  "realtime_reconnected",
  /** History had to be fetched again to catch up after a gap. */
  "history_caught_up",
  /** An upload was refused by client-side validation. */
  "upload_refused",
  /** The call could not be started for a documented reason. */
  "call_refused",
] as const;

export type MetricEvent = (typeof METRIC_EVENTS)[number];

/**
 * A single reading.
 *
 * `value` is a count, a duration in milliseconds or a percentage - always a number. `code` is
 * a fixed label from the caller, and it is checked: it may only contain lowercase letters,
 * digits and underscores, so an error string can never be passed as a code by accident.
 */
export type MetricSample = {
  event: MetricEvent;
  value: number;
  code?: string;
  /** When it happened, in milliseconds since the epoch. */
  at: number;
};

/** Codes are short and machine-shaped on purpose: a human sentence would be content. */
const CODE_PATTERN = /^[a-z0-9_]{1,40}$/;

export function isMetricEvent(value: unknown): value is MetricEvent {
  return typeof value === "string" && (METRIC_EVENTS as readonly string[]).includes(value);
}

/**
 * True when a sample is safe to keep: a known event, a finite number, and a code that cannot
 * carry a sentence, a file name or a message.
 */
export function isValidSample(sample: MetricSample): boolean {
  if (!isMetricEvent(sample.event)) return false;
  if (!Number.isFinite(sample.value)) return false;
  if (sample.code !== undefined && !CODE_PATTERN.test(sample.code)) return false;
  if (!Number.isFinite(sample.at)) return false;
  return true;
}

/**
 * Sums and counts, per event, over a set of samples.
 *
 * This is what would ever leave the device: totals, not a timeline. `averageMs` is only filled
 * for events whose value is a duration, and the caller decides which those are.
 */
export type MetricSummary = {
  event: MetricEvent;
  count: number;
  total: number;
  average: number;
  /** Distinct codes seen, as a name-to-count map - never more than the code alphabet allows. */
  codes: Record<string, number>;
};

export function summarise(samples: MetricSample[]): MetricSummary[] {
  const byEvent = new Map<MetricEvent, MetricSummary>();
  for (const sample of samples) {
    if (!isValidSample(sample)) continue;
    const existing = byEvent.get(sample.event);
    const entry =
      existing ??
      ({ event: sample.event, count: 0, total: 0, average: 0, codes: {} } satisfies MetricSummary);
    entry.count += 1;
    entry.total += sample.value;
    entry.average = entry.total / entry.count;
    if (sample.code) entry.codes[sample.code] = (entry.codes[sample.code] ?? 0) + 1;
    byEvent.set(sample.event, entry);
  }
  return [...byEvent.values()].sort((a, b) => a.event.localeCompare(b.event));
}

/** The rule the whole file exists for, expressed as a check that can be tested. */
export function assertNoContent(sample: MetricSample): void {
  if (!isValidSample(sample)) {
    throw new Error("Показатель не может покинуть устройство в таком виде: допустимы только число и короткий код");
  }
}

/**
 * A reading of "is the app healthy right now", from numbers a browser already knows.
 *
 * Nothing here is a message. They are the measurements that say whether delivery is working:
 * how long a send took, how often the connection dropped, how many attempts had to be retried.
 */
export type HealthSnapshot = {
  /** Failed sends divided by attempts, 0 to 1. */
  failureRate: number;
  /** Mean time from handing a message to the network to seeing it acknowledged. */
  averageSendMs: number;
  /** How many times the realtime connection had to be re-established. */
  reconnects: number;
  /** 0 to 100: a single headline number for a status screen. */
  score: number;
};

export function healthSnapshot(samples: MetricSample[]): HealthSnapshot {
  const summary = summarise(samples);
  const find = (event: MetricEvent) => summary.find((entry) => entry.event === event);
  const sent = find("message_sent");
  const failed = find("message_failed");
  const reconnected = find("realtime_reconnected");

  const attempts = (sent?.count ?? 0) + (failed?.count ?? 0);
  const failureRate = attempts === 0 ? 0 : (failed?.count ?? 0) / attempts;
  const averageSendMs = sent?.average ?? 0;
  const reconnects = reconnected?.count ?? 0;

  // Each problem takes points away; none of them can take more than its own share, so the
  // score never goes below zero because of one broken thing counted twice.
  //
  // Total failure has to read as total failure: a cap per term would leave a delivery system
  // where nothing arrives showing "10 out of 100", which is a worse lie than a low number.
  // So the failure share alone can take the whole score, and reconnects take from what is left.
  const failurePenalty = Math.round(Math.min(1, failureRate) * 100);
  const reconnectPenalty = Math.min(30, reconnects * 5);
  const score = Math.max(0, 100 - failurePenalty - (failurePenalty >= 100 ? 0 : reconnectPenalty));

  return { failureRate, averageSendMs, reconnects, score };
}

/** A sentence for a status screen, honest about what is being measured. */
export function healthLabel(snapshot: HealthSnapshot): string {
  if (snapshot.score >= 95) return "Доставка работает нормально";
  if (snapshot.score >= 75) return "Есть сбои доставки, но сообщения доходят";
  if (snapshot.score >= 40) return "Доставка нестабильна";
  return "Сообщения чаще не доходят, чем доходят";
}
