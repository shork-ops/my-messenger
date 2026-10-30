import { useState } from "react";
import { formatBytes } from "../lib/media";
import { albumLayout } from "../lib/albums";
import type { AlbumItem } from "../types";

type Props = {
  items: AlbumItem[];
  /** False when the download policy says pictures wait for a tap. */
  autoload: boolean;
};

/**
 * Several pictures sent as one message.
 *
 * The grid is decided by how many pictures there are, not by how big they turn out to be, so
 * it never changes shape while the images arrive. That matters more than a perfect cropping
 * rule: a conversation that jumps under the reader is the thing people notice.
 *
 * Each picture holds its own tap-to-load state, because a policy that says "1024 КБ of
 * pictures is too much to fetch unasked" should not be defeated by the first one being
 * tapped.
 */
export default function AlbumGrid({ items, autoload }: Props) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const layout = albumLayout(items.length);

  return (
    <div
      className={`album-grid album-columns-${layout.columns} album-count-${Math.min(items.length, 10)}`}
      role="group"
      aria-label={`Альбом: ${items.length} фото`}
    >
      {items.map((item, index) => {
        const show = autoload || revealed[index];
        return (
          <figure className="album-cell" key={`${item.name}-${index}`}>
            {show ? (
              <img
                className="album-image"
                src={item.thumbnail || item.data}
                data-full-src={item.thumbnail ? item.data : undefined}
                alt={item.name}
                loading="lazy"
                onError={(event) => {
                  const full = event.currentTarget.dataset.fullSrc;
                  if (full && event.currentTarget.src !== full) event.currentTarget.src = full;
                }}
              />
            ) : (
              // The size is shown before the bytes are fetched, so the tap is an informed
              // one rather than a guess at what is behind it.
              <button
                type="button"
                className="album-hold"
                onClick={() => setRevealed((current) => ({ ...current, [index]: true }))}
                aria-label={`Загрузить изображение ${item.name}`}
              >
                <span className="album-hold-hint">{formatBytes(item.size)}</span>
              </button>
            )}
          </figure>
        );
      })}
    </div>
  );
}
