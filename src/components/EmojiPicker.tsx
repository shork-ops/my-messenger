import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { isEmojiEmpty, searchEmoji } from "../lib/emoji";

type EmojiPickerProps = {
  onPick: (char: string) => void;
  onClose: () => void;
};

/**
 * An emoji picker with search.
 *
 * Browsing all of them is slow past a few dozen, so the field is focused on open and
 * a word finds the one you mean. Searching by the word you would say is the whole
 * point: nobody thinks in code points.
 */
export default function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const results = useMemo(() => searchEmoji(query), [query]);
  const empty = isEmojiEmpty(query);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="emoji-picker" role="dialog" aria-label="Эмодзи">
      <label className="emoji-search">
        <Search size={15} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Найти эмодзи"
          aria-label="Найти эмодзи"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {empty ? (
        <p className="emoji-empty">Ничего не нашлось. Попробуй другое слово.</p>
      ) : (
        <div className="emoji-grid">
          {results.map((entry) => (
            <button
              key={entry.char}
              type="button"
              className="emoji-item"
              aria-label={entry.words.split(" ")[0]}
              title={entry.words}
              onClick={() => onPick(entry.char)}
            >
              {entry.char}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
