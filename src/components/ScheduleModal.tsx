import { useEffect } from "react";
import { Clock } from "lucide-react";
import { formatSendAt, scheduleChoices } from "../lib/scheduling";

type ScheduleModalProps = {
  /** What will be sent, so the choice is made about a real message. */
  text: string;
  onPick: (at: Date) => void;
  onClose: () => void;
};

/**
 * Choosing when to send.
 *
 * The draft is shown because "send at nine" is a decision about a particular message, and
 * picking a time for something you cannot see means remembering what it was.
 *
 * The choices are moments, not a date field: nearly every scheduled message means "later
 * today", "this evening" or "tomorrow morning", and a date picker makes the common case the
 * slow one.
 */
export default function ScheduleModal({ text, onPick, onClose }: ScheduleModalProps) {
  const now = new Date();
  const choices = scheduleChoices(now);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal schedule-modal"
        role="dialog"
        aria-label="Отправить позже"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2>
            <Clock size={18} /> Отправить позже
          </h2>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>

        <p className="schedule-preview">{text.length > 140 ? `${text.slice(0, 140)}…` : text}</p>

        <div className="schedule-choices">
          {choices.map((choice) => (
            <button
              type="button"
              key={choice.label}
              className="schedule-choice"
              onClick={() => onPick(choice.at)}
              aria-label={`${choice.label}: ${formatSendAt(choice.at, now)}`}
            >
              <strong>{choice.label}</strong>
              <small>{formatSendAt(choice.at, now)}</small>
            </button>
          ))}
        </div>

        {/* Said plainly, because it is the difference between "scheduled" and "scheduled
            only if my laptop stays open". */}
        <p className="settings-note">
          Сообщение уйдёт, даже если вы закроете мессенджер: время хранится на сервере. До этого
          момента его видите только вы.
        </p>
      </div>
    </div>
  );
}
