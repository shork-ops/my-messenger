import { useEffect } from "react";
import type { MutableRefObject } from "react";

export function useAutoScroll(ref: MutableRefObject<HTMLElement | null>, dependencies: unknown[]) {
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}
