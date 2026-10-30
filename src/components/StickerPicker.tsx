import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { searchStickers, STICKERS } from "../lib/stickers";

type StickerPickerProps = {
  onPick: (stickerId: string) => void;
  onClose: () => void;
};

/**
 * A sticker picker, built like the emoji picker: the search field is focused on open,
 * because a pack you have to browse is a pack you stop using after a week.
 *
 * The heading only appears when nothing is typed. Once someone is searching, the pack name
 * is noise above the two results they are actually looking at.
 */
export default function StickerPicker({ onPick, onClose }: StickerPickerProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const results = searchStickers(query);
  const searching = query.trim() !== "";

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
    <div className="emoji-picker sticker-picker" role="dialog" aria-label="Стикеры">
      <label className="emoji-search">
        <Search size={15} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Найти стикер"
          aria-label="Найти стикер"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {results.length === 0 ? (
        <p className="emoji-empty">Ничего не нашлось. Попробуй другое слово.</p>
      ) : (
        <>
          {!searching && <p className="sticker-pack-name">Повседневные · {STICKERS.length}</p>}
          <div className="sticker-grid">
            {results.map((sticker) => (
              <button
                key={sticker.id}
                type="button"
                className={`sticker-item sticker-tone-${sticker.tone}`}
                aria-label={`Стикер: ${sticker.label}`}
                title={sticker.label}
                onClick={() => onPick(sticker.id)}
              >
                <span aria-hidden="true">{sticker.glyph}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
