/**
 * Albums.
 *
 * Several pictures chosen at once are one message with a grid, not several messages. That is
 * not only a matter of taste: five separate messages push a conversation five lines further
 * down and make the ten photos after them arrive as ten separate notifications.
 *
 * The layout is computed from the count alone rather than measured from the images, so the
 * grid does not change shape while pictures load. A conversation that jumps under the reader
 * is the failure this avoids.
 */

/** Ten is where a grid stops being a grid and becomes a scroll. */
export const MAX_ALBUM_SIZE = 10;

export type AlbumLayout = { columns: number; rows: number };

/** How to lay out an album of this many pictures. */
export function albumLayout(count: number): AlbumLayout {
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count === 2) return { columns: 2, rows: 1 };
  if (count <= 4) return { columns: 2, rows: 2 };
  return { columns: 3, rows: Math.ceil(count / 3) };
}

/** Splits a selection into albums the limit allows, keeping the chosen order. */
export function splitIntoAlbums<T>(items: T[]): T[][] {
  const albums: T[][] = [];
  for (let index = 0; index < items.length; index += MAX_ALBUM_SIZE) {
    albums.push(items.slice(index, index + MAX_ALBUM_SIZE));
  }
  return albums;
}
