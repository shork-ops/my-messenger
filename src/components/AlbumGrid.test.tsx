/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AlbumGrid from "./AlbumGrid";
import type { AlbumItem } from "../types";

/**
 * The album grid.
 *
 * These assert the geometry rather than the picture look: the classes that decide the column
 * count are what keeps the conversation from jumping while the images arrive, and a wrong
 * class is invisible in a screenshot.
 */

const item = (index: number): AlbumItem => ({
  name: `фото-${index}.jpg`,
  type: "image/jpeg",
  size: 100_000,
  data: `data:image/png;base64,iVBORw0KGgo=${index}`,
});

describe("AlbumGrid", () => {
  it("draws one cell per picture", () => {
    const { container } = render(<AlbumGrid items={[1, 2, 3, 4, 5].map(item)} autoload />);
    expect(container.querySelectorAll(".album-cell")).toHaveLength(5);
    expect(container.querySelectorAll("img")).toHaveLength(5);
  });

  it("picks the column count from the number of pictures", () => {
    const { container: two } = render(<AlbumGrid items={[item(1), item(2)]} autoload />);
    expect(two.querySelector(".album-grid")?.className).toContain("album-columns-2");

    const { container: four } = render(<AlbumGrid items={[1, 2, 3, 4].map(item)} autoload />);
    expect(four.querySelector(".album-grid")?.className).toContain("album-columns-2");

    const { container: five } = render(<AlbumGrid items={[1, 2, 3, 4, 5].map(item)} autoload />);
    expect(five.querySelector(".album-grid")?.className).toContain("album-columns-3");
  });

  it("says how many pictures there are to a screen reader", () => {
    render(<AlbumGrid items={[1, 2, 3].map(item)} autoload />);
    const groups = screen.getAllByRole("group", { name: "Альбом: 3 фото" });
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("waits for a tap when the download policy says so, one picture at a time", () => {
    const { container } = render(<AlbumGrid items={[item(1), item(2), item(3)]} autoload={false} />);
    // Nothing is fetched until asked.
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll(".album-hold")).toHaveLength(3);

    const holds = Array.from(container.querySelectorAll(".album-hold"));
    fireEvent.click(holds[1]);
    // Only the tapped one: a policy about traffic should not be defeated by one tap.
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelectorAll(".album-hold")).toHaveLength(2);
  });

  it("uses the name as the alternative text", () => {
    const { container } = render(<AlbumGrid items={[item(7), item(8)]} autoload />);
    const images = Array.from(container.querySelectorAll("img")).map((node) => node.getAttribute("alt"));
    expect(images).toEqual(["фото-7.jpg", "фото-8.jpg"]);
  });
});
