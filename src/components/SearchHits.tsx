import { ChevronDown } from "lucide-react";
import { splitHeadline } from "../lib/messageSearch";
import type { SearchHit } from "../lib/messageSearch";

type SearchHitsProps = {
  hits: SearchHit[];
  loading: boolean;
  hasMore: boolean;
  error: string;
  /** Names resolved for the senders shown in the hits. */
  authorOf: (userId: string) => string;
  timeOf: (iso: string) => string;
  onOpen: (hit: SearchHit) => void;
  onLoadMore: () => void;
};

/**
 * Results of the full-history search, shown above the loaded messages.
 *
 * The highlighted fragments come from Postgres `ts_headline`, so they are
 * rendered as React text nodes and never injected as HTML.
 */
export default function SearchHits({ hits, loading, hasMore, error, authorOf, timeOf, onOpen, onLoadMore }: SearchHitsProps) {
  if (error) return <div className="search-state search-error">{error}</div>;
  if (loading && hits.length === 0) return <div className="search-state">Ищу по всей истории…</div>;
  if (hits.length === 0) return null;

  return (
    <div className="search-hits">
      <div className="search-hits-heading">
        <span>Найдено в истории</span>
        <b>{hits.length}</b>
      </div>
      {hits.map((hit) => (
        <button key={hit.id} type="button" className="search-hit" onClick={() => onOpen(hit)}>
          <span className="search-hit-copy">
            <strong>
              {authorOf(hit.senderId)} · {timeOf(hit.createdAt)}
            </strong>
            <span>
              {splitHeadline(hit.headline).map((part, index) =>
                part.marked ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>
              )}
            </span>
          </span>
        </button>
      ))}
      {hasMore && (
        <button type="button" className="search-more" onClick={onLoadMore} disabled={loading}>
          <ChevronDown size={14} /> {loading ? "Загружаю…" : "Ещё результаты"}
        </button>
      )}
    </div>
  );
}
