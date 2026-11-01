import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  NORMAL_TEMPERATURE,
  coolText,
  formatDegrees,
  heatTitle,
  scalePosition,
  temperature,
} from "../lib/coolText";
import { formatSendAt } from "../lib/scheduling";
import "../styles/cool-down.css";

/** One half of a breath: four seconds in, four out. */
export const BREATH_MS = 4000;
/** Two full breaths: long enough to change the mood, short enough not to be a chore. */
export const BREATH_STEPS = 4;
const PAUSE_SECONDS = (BREATH_MS * BREATH_STEPS) / 1000;

type CoolDownSheetProps = {
  /** The draft that was about to be sent. */
  text: string;
  /** Tomorrow's (or today's) nine o'clock; null where a message cannot wait on the server. */
  morning: Date | null;
  /** The softened text and its temperature, to put back into the composer. */
  onCool: (cooled: string, degrees: string) => void;
  onSendAnyway: () => void;
  onMorning: (at: Date) => void;
  onDisable: () => void;
  onClose: () => void;
};

type Phase = "choose" | "breathe" | "after";

/**
 * «Анти-ссора»: shown instead of sending when the message is shouted.
 *
 * It never decides for the person. Every way out is one tap, sending as it was included, and
 * nothing leaves without a choice: the softened text goes back into the composer to be read,
 * the pause ends in the same choices, and the morning option is an ordinary scheduled message.
 *
 * The thermometer is a joke with a point. A number that falls from 87° to 36,6° says what
 * the change does faster than a sentence about tone.
 */
export default function CoolDownSheet({ text, morning, onCool, onSendAnyway, onMorning, onDisable, onClose }: CoolDownSheetProps) {
  const heat = useMemo(() => temperature(text), [text]);
  const cooled = useMemo(() => coolText(text), [text]);
  const cooledHeat = useMemo(() => temperature(cooled), [cooled]);
  const canCool = cooled !== text.trim();
  const [phase, setPhase] = useState<Phase>("choose");
  // The needle starts at normal and swings up once drawn, so the heat is something you see.
  const [needle, setNeedle] = useState(NORMAL_TEMPERATURE);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setNeedle(heat), 40);
    return () => window.clearTimeout(timer);
  }, [heat]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (phase !== "breathe") return;
    // The fresh needle is drawn at the heat first, then sent slowly down to normal.
    const start = window.setTimeout(() => setNeedle(NORMAL_TEMPERATURE), 40);
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase === "breathe" && elapsed >= PAUSE_SECONDS) finishBreathing();
  }, [phase, elapsed]);

  function startBreathing() {
    setElapsed(0);
    setPhase("breathe");
    setNeedle(heat);
  }

  function finishBreathing() {
    setPhase("after");
    setNeedle(NORMAL_TEMPERATURE);
  }

  // While breathing the number cools second by second, all the way to normal.
  const shown =
    phase === "breathe"
      ? heat - ((heat - NORMAL_TEMPERATURE) * Math.min(elapsed, PAUSE_SECONDS)) / PAUSE_SECONDS
      : needle;
  const { icon, title } = phase === "after" ? { icon: "🌿", title: "Ну как, полегчало?" } : heatTitle(heat);
  const inhaling = Math.floor((elapsed * 1000) / BREATH_MS) % 2 === 0;
  const now = new Date();

  const coolButton = canCool && (
    <button type="button" className="cool-option cool-option-ice" onClick={() => onCool(cooled, formatDegrees(cooledHeat))} autoFocus>
      <span aria-hidden="true">🧊</span>
      <span>
        <strong>Остудить</strong>
        <small>Строчные буквы и один «!» — текст вернётся в поле, отправите сами</small>
      </span>
    </button>
  );
  const morningButton = morning && (
    <button type="button" className="cool-option" onClick={() => onMorning(morning)}>
      <span aria-hidden="true">🌅</span>
      <span>
        <strong>Отправить утром</strong>
        <small>{formatSendAt(morning, now)} · утро вечера мудренее</small>
      </span>
    </button>
  );
  const anywayButton = (
    <button type="button" className="cool-option cool-option-fire" onClick={onSendAnyway}>
      <span aria-hidden="true">🔥</span>
      <span>
        <strong>Отправить как есть</strong>
        <small>Иногда капс — это правда важно</small>
      </span>
    </button>
  );

  return (
    <div className="modal-backdrop cool-backdrop" onClick={onClose}>
      <section
        className={`cool-sheet cool-${phase}${heat >= 65 ? " cool-hot" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cool-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="cool-header">
          <span className="cool-icon" aria-hidden="true">
            {icon}
          </span>
          <h2 id="cool-title">{title}</h2>
          <button type="button" className="cool-close" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>

        <div className="cool-meter" role="meter" aria-label="Накал" aria-valuemin={NORMAL_TEMPERATURE} aria-valuemax={100} aria-valuenow={Math.round(shown * 10) / 10} aria-valuetext={formatDegrees(shown)}>
          <div className="cool-meter-label">
            <span>Накал</span>
            <strong>{formatDegrees(shown)}</strong>
          </div>
          <div className="cool-track">
            {/* A new needle for the pause and after it: a running transition keeps its own
                length, so a skipped pause would otherwise drift for the rest of sixteen seconds. */}
            <i
              key={phase}
              className={`cool-needle${phase === "breathe" ? " cool-needle-slow" : ""}`}
              style={{ left: `${scalePosition(needle) * 100}%` }}
            />
          </div>
        </div>

        {phase === "choose" && (
          <>
            <p className="cool-lead">Больше трёх слов капсом читаются как крик — даже если вы просто торопились.</p>
            {canCool && (
              <div className="cool-compare">
                <figure>
                  <figcaption>Сейчас · {formatDegrees(heat)}</figcaption>
                  <p>{text}</p>
                </figure>
                <figure className="cool-compare-calm">
                  <figcaption>Если остудить · {formatDegrees(cooledHeat)}</figcaption>
                  <p>{cooled}</p>
                </figure>
              </div>
            )}
            <div className="cool-options">
              {coolButton}
              <button type="button" className="cool-option" onClick={startBreathing} autoFocus={!canCool}>
                <span aria-hidden="true">🫁</span>
                <span>
                  <strong>Подышать {PAUSE_SECONDS} секунд</strong>
                  <small>Два медленных вдоха, а потом решите</small>
                </span>
              </button>
              {morningButton}
              {anywayButton}
            </div>
            <button type="button" className="cool-disable" onClick={onDisable}>
              Больше не предлагать
            </button>
          </>
        )}

        {phase === "breathe" && (
          <div className="cool-breath">
            <div className={`cool-breath-circle ${inhaling ? "cool-in" : "cool-out"}`} aria-hidden="true" />
            <p className="cool-breath-word" aria-live="polite">
              {inhaling ? "Вдох…" : "Выдох…"}
            </p>
            <small>Ещё {PAUSE_SECONDS - elapsed} с</small>
            <button type="button" className="cool-skip" onClick={finishBreathing}>
              Пропустить
            </button>
          </div>
        )}

        {phase === "after" && (
          <>
            <p className="cool-lead">Сообщение то же самое. Теперь решите, каким ему уйти.</p>
            <div className="cool-options">
              {coolButton}
              <button type="button" className="cool-option" onClick={onClose} autoFocus={!canCool}>
                <span aria-hidden="true">✏️</span>
                <span>
                  <strong>Поправлю текст</strong>
                  <small>Вернуться к тексту, ничего не отправляя</small>
                </span>
              </button>
              {morningButton}
              {anywayButton}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
