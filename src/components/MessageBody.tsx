import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatMarkup, plainText, type MarkupSegment } from "../lib/markup";
import { linkifySegments } from "../lib/links";

/**
 * Renders a message body with its markup and its @mentions.
 *
 * Mentions are found inside plain runs only: an @ inside a code span is part of the code,
 * and highlighting it would make `npm install @scope/pkg` look like the author addressed
 * someone.
 */

type Props = {
  text: string;
};

/** Splits a plain run into mentions and the text between them. */
function withMentions(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(@[\p{L}\p{N}_]+)/gu).map((part, index) => {
    if (part === "") return null;
    if (part.startsWith("@")) {
      return (
        <strong className="message-mention" key={`${keyPrefix}-m${index}`}>
          {part}
        </strong>
      );
    }
    return <span key={`${keyPrefix}-t${index}`}>{part}</span>;
  });
}

/** The classes a segment wears: its kind plus any flags wrapped around it. */
function classesFor(segment: MarkupSegment): string {
  const classes: string[] = [];
  if (segment.kind === "bold") classes.push("markup-bold");
  if (segment.kind === "italic") classes.push("markup-italic");
  if (segment.kind === "strike") classes.push("markup-strike");
  if (segment.bold && segment.kind !== "bold") classes.push("markup-bold");
  if (segment.italic && segment.kind !== "italic") classes.push("markup-italic");
  if (segment.strike && segment.kind !== "strike") classes.push("markup-strike");
  return classes.join(" ");
}

/** A spoiler stays covered until it is tapped, and can be covered again. */
function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className={`markup-spoiler ${open ? "revealed" : ""}`}
      onClick={(event) => {
        // The bubble has its own click handlers for long press and actions; revealing a
        // spoiler must not also open the message menu.
        event.stopPropagation();
        setOpen((current) => !current);
      }}
      aria-label={open ? "Скрыть спойлер" : "Показать спойлер"}
      aria-expanded={open}
    >
      {children}
    </button>
  );
}

/** How long the dust takes to blow away; the text is swapped in when it has. */
export const HIDDEN_OPEN_MS = 420;

/**
 * A hidden message: covered with moving dust until it is tapped, as in Telegram.
 *
 * The cover is the text itself with its letters made transparent, so the dust lies exactly
 * over the lines the message will take, and nothing jumps when it opens. Under the cover the
 * text is plain - no links, no mentions: a cover that could be tapped through to a link would
 * open it unseen. It is a div with a button role rather than a button, because the bubble
 * leaves a long press on a button alone, and a hidden message must still open the menu.
 */
export function HiddenBody({ text }: Props) {
  const [phase, setPhase] = useState<"covered" | "opening" | "open">("covered");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  if (phase === "open") {
    return (
      <div className="hidden-message open">
        <MessageBody text={text} />
      </div>
    );
  }

  function reveal() {
    if (phase !== "covered") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPhase("open");
      return;
    }
    setPhase("opening");
    timer.current = setTimeout(() => setPhase("open"), HIDDEN_OPEN_MS);
  }

  return (
    <div
      className={`hidden-message ${phase}`}
      role="button"
      tabIndex={0}
      aria-label="Скрытое сообщение. Нажмите, чтобы прочитать"
      onClick={(event) => {
        // The bubble has its own click handling for long press and actions.
        event.stopPropagation();
        reveal();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          reveal();
        }
      }}
    >
      <span className="hidden-ink" aria-hidden="true">
        {plainText(text)}
      </span>
    </div>
  );
}

export default function MessageBody({ text }: Props) {
  return (
    <>
      {linkifySegments(formatMarkup(text)).map((segment, index) => {
        const key = `s${index}`;
        if (segment.kind === "spoiler") {
          return <Spoiler key={key}>{withMentions(segment.text, key)}</Spoiler>;
        }
        if (segment.kind === "pre") {
          return (
            <pre className="markup-pre" key={key} data-language={segment.language}>
              <code>{segment.text}</code>
            </pre>
          );
        }
        if (segment.kind === "link") {
          return (
            <a
              className="message-link"
              key={key}
              href={segment.href}
              target="_blank"
              // noreferrer as well as noopener: the receiving site has no business knowing
              // which conversation the link came from.
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              {segment.text}
            </a>
          );
        }
        if (segment.kind === "code") {
          return (
            <code className="markup-code" key={key}>
              {segment.text}
            </code>
          );
        }
        const classes = classesFor(segment);
        if (classes === "") return <span key={key}>{withMentions(segment.text, key)}</span>;
        return (
          <span className={classes} key={key}>
            {withMentions(segment.text, key)}
          </span>
        );
      })}
    </>
  );
}
