/**
 * The complaint dialog.
 *
 * It asks one question at a time: what is wrong, optionally in your own words, and then says
 * what happened. The text after sending does not promise that the message will be removed,
 * because it will not be removed automatically - it goes into a queue and stays until someone
 * reads it. Promising more would be a promise this code cannot keep.
 */

import { useState } from "react";
import { X } from "lucide-react";
import {
  REPORT_DETAILS_LIMIT,
  REPORT_DUPLICATE,
  REPORT_REASONS,
  REPORT_SENT,
  clampDetails,
  reportPrompt,
  type ReportReason,
  type ReportTarget,
} from "../lib/reports";
import { submitReport } from "../lib/reportSubmit";

type ReportModalProps = {
  target: ReportTarget;
  onClose: () => void;
};

export default function ReportModal({ target, onClose }: ReportModalProps) {
  const mode = target.messageId ? "message" : "chat";
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const clamped = clampDetails(details);

  async function send() {
    if (!reason || sending) return;
    setSending(true);
    setProblem(null);
    const outcome = await submitReport(target, reason, details);
    setSending(false);
    if (!outcome.ok) {
      setProblem(outcome.message);
      return;
    }
    setResult(outcome.duplicate ? REPORT_DUPLICATE : REPORT_SENT);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="report-modal"
        role="dialog"
        aria-label="Жалоба"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="report-modal-header">
          <h2>Жалоба</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </header>

        {result ? (
          <>
            <p className="report-result" role="status">
              {result}
            </p>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Понятно
            </button>
          </>
        ) : (
          <>
            <p className="report-question">{reportPrompt(mode)}</p>

            <fieldset className="report-reasons">
              <legend className="visually-hidden">Причина</legend>
              {REPORT_REASONS.map((option) => (
                <label key={option.id} className="report-reason">
                  <input
                    type="radio"
                    name="report-reason"
                    value={option.id}
                    checked={reason === option.id}
                    onChange={() => setReason(option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>

            <label className="report-details-label">
              Подробности, если хотите
              <textarea
                className="report-details"
                value={details}
                maxLength={REPORT_DETAILS_LIMIT + 200}
                onChange={(event) => setDetails(event.target.value)}
                placeholder="Что именно произошло"
                rows={3}
              />
            </label>
            {clamped.truncated && (
              <p className="game-hint" role="alert">
                Текст длиннее {REPORT_DETAILS_LIMIT} символов — при отправке он будет сокращён.
              </p>
            )}

            {problem && (
              <p className="game-notice" role="alert">
                {problem}
              </p>
            )}

            <div className="report-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Отмена
              </button>
              <button type="button" className="btn btn-primary" disabled={!reason || sending} onClick={() => void send()}>
                {sending ? "Отправляем…" : "Отправить жалобу"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
