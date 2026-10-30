import { useState } from "react";
import { Link2 } from "lucide-react";
import { cardImage, cardSite, type LinkCard } from "../lib/links";

type Props = {
  card: LinkCard;
};

/**
 * A link's preview card.
 *
 * The picture is not loaded until the card is on screen: a conversation with ten links would
 * otherwise fetch ten images from ten unknown hosts before the reader has looked at any of
 * them, which is both slow and a small privacy leak. The click does not go through the card -
 * the link is already in the message, and a second link over the same URL makes the keyboard
 * order twice as long for no gain.
 */
export default function LinkPreview({ card }: Props) {
  const [imageHidden, setImageHidden] = useState(false);
  const image = cardImage(card);
  const site = cardSite(card);

  return (
    <div className="link-card">
      <div className="link-card-body">
        <span className="link-card-site">
          <Link2 size={12} /> {site}
        </span>
        <strong className="link-card-title">{card.title || site}</strong>
        {card.description && <span className="link-card-description">{card.description}</span>}
      </div>
      {image && !imageHidden && (
        <img
          className="link-card-image"
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          // A broken picture is not worth a broken card: the text stays.
          onError={() => setImageHidden(true)}
        />
      )}
    </div>
  );
}
