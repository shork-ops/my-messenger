import { describe, expect, it } from "vitest";
import { albumLayout, MAX_ALBUM_SIZE, splitIntoAlbums } from "./albums";

/**
 * Albums.
 *
 * Two pictures sent together are one thought, not two messages, so they are drawn as a grid.
 * The layout rules matter more than they look: a grid that changes shape as pictures load
 * makes a conversation jump while it is being read.
 */

describe("albumLayout", () => {
  it("gives a single picture its own shape", () => {
    expect(albumLayout(1)).toEqual({ columns: 1, rows: 1 });
  });

  it("puts two side by side", () => {
    expect(albumLayout(2)).toEqual({ columns: 2, rows: 1 });
  });

  it("uses a square for three and four", () => {
    expect(albumLayout(3).columns).toBe(2);
    expect(albumLayout(4)).toEqual({ columns: 2, rows: 2 });
  });

  it("uses three columns from five upwards", () => {
    expect(albumLayout(5).columns).toBe(3);
    expect(albumLayout(6).columns).toBe(3);
    expect(albumLayout(9).columns).toBe(3);
    expect(albumLayout(10).columns).toBe(3);
  });

  it("never asks for more rows than it has pictures to fill them with", () => {
    for (let count = 1; count <= MAX_ALBUM_SIZE; count += 1) {
      const layout = albumLayout(count);
      expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(count);
      expect(layout.rows).toBe(Math.ceil(count / layout.columns));
    }
  });

  it("handles a zero count without dividing by zero", () => {
    expect(albumLayout(0)).toEqual({ columns: 1, rows: 1 });
  });
});

describe("splitIntoAlbums", () => {
  const files = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `f${index}.jpg` }));

  it("keeps a small selection in one album", () => {
    expect(splitIntoAlbums(files(4))).toHaveLength(1);
  });

  it("splits a selection larger than the limit", () => {
    const albums = splitIntoAlbums(files(MAX_ALBUM_SIZE + 3));
    expect(albums).toHaveLength(2);
    expect(albums[0]).toHaveLength(MAX_ALBUM_SIZE);
    expect(albums[1]).toHaveLength(3);
  });

  it("returns nothing for an empty selection", () => {
    expect(splitIntoAlbums([])).toEqual([]);
  });

  it("keeps the order the files were chosen in", () => {
    const chosen = files(3);
    expect(splitIntoAlbums(chosen)[0]).toEqual(chosen);
  });
});
