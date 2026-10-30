import { useState, type ReactNode } from "react";
import { formatMarkup, type MarkupSegment } from "../lib/markup";

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

export default function MessageBody({ text }: Props) {
  return (
    <>
      {formatMarkup(text).map((segment, index) => {
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
