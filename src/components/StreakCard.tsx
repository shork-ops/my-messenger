import { useEffect } from "react";
import { X } from "lucide-react";
import { STREAK_LEVELS, STREAK_RISK_HOUR, dayWord, nextStreakLevel, streakLevel, type Streak } from "../lib/streakEngine";
import "../styles/streaks.css";

type StreakCardProps = {
  chatName: string;
  streak: Streak;
  onClose: () => void;
  /** For tests; the card otherwise reads the clock. */
  now?: Date;
};

function untilMidnight(now: Date): string {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const minutes = Math.max(0, Math.floor((midnight.getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} ч ${minutes % 60} мин` : `${minutes} мин`;
}

/**
 * «Огонёк дружбы» opened from the chat header: how long it burns, what it grows into, and -
 * the useful part - what today still needs, said as a plain next step.
 */
export default function StreakCard({ chatName, streak, onClose, now = new Date() }: StreakCardProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const level = streak.alive ? streakLevel(streak.days) : null;
  const next = streak.alive ? nextStreakLevel(streak.days) : STREAK_LEVELS[0];
  const from = level?.days ?? 0;
  const progress = next ? Math.min(1, (streak.days - from) / (next.days - from)) : 1;
  const risk = streak.alive && !streak.todayDone && now.getHours() >= STREAK_RISK_HOUR;

  let today: string;
  if (!streak.alive) today = "Напишите друг другу сегодня — и завтра зажжётся новая искорка.";
  else if (streak.todayDone) today = "Сегодня уже засчитан — огонёк горит до завтрашней полуночи.";
  else if (streak.todayMine) today = "Ждём ответа — собеседнику хватит одного сообщения до полуночи.";
  else if (streak.todayTheirs) today = "От собеседника сегодня уже есть сообщение — ваша очередь!";
  else today = "Сегодня ещё никто не писал. Хватит одного сообщения от каждого.";

  return (
    <div className="modal-backdrop streak-backdrop" onClick={onClose}>
      <section
        className={`streak-card${streak.alive ? "" : " streak-card-out"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="streak-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="streak-card-header">
          <h2 id="streak-title">Огонёк дружбы</h2>
          <button type="button" className="streak-close" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>

        <div className="streak-hero">
          <span className="streak-flame" aria-hidden="true">
            {level?.icon ?? "🧊"}
          </span>
          {streak.alive ? (
            <>
              <strong>
                {streak.days} {dayWord(streak.days)} подряд
              </strong>
              <span className="streak-level">{level?.name}</span>
            </>
          ) : (
            <>
              <strong>Огонёк погас</strong>
              <span className="streak-level">
                вчера, после {streak.lost} {dayWord(streak.lost)}
              </span>
            </>
          )}
        </div>

        {next && (
          <div className="streak-progress">
            <div className="streak-progress-label">
              <span>
                {streak.alive ? `До уровня «${next.name}» ${next.icon}` : `Первый уровень — «${next.name}» ${next.icon}`}
              </span>
              <span>
                ещё {next.days - streak.days} {dayWord(next.days - streak.days)}
              </span>
            </div>
            <div className="streak-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="До следующего уровня">
              <i style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="streak-today">
          <span className="streak-today-title">Сегодня</span>
          <div className="streak-people">
            <span className={streak.todayMine ? "done" : ""}>{streak.todayMine ? "✓" : "…"} Вы</span>
            <span className={streak.todayTheirs ? "done" : ""}>
              {streak.todayTheirs ? "✓" : "…"} {chatName}
            </span>
          </div>
          <p>{today}</p>
          {risk && <p className="streak-risk">⏳ До полуночи {untilMidnight(now)}</p>}
        </div>

        <ol className="streak-ladder" aria-label="Уровни">
          {STREAK_LEVELS.map((item) => (
            <li
              key={item.days}
              className={`${streak.alive && streak.days >= item.days ? "reached" : ""}${level?.days === item.days ? " current" : ""}`}
              title={`${item.name} — ${item.days} ${dayWord(item.days)}`}
            >
              <span aria-hidden="true">{item.icon}</span>
              <small>{item.days}</small>
            </li>
          ))}
        </ol>

        <p className="streak-rule">
          Рекорд: {streak.record} {dayWord(streak.record)}. Огонёк растёт, когда вы оба пишете хотя бы по сообщению в день;
          пропущенный день его гасит. Считается только в личных чатах.
        </p>
      </section>
    </div>
  );
}
