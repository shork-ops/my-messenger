import { useEffect } from "react";

/** Keep the composer in the visible viewport when a phone keyboard opens. */
export function useMobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (viewport && viewport.scale !== 1) return;
        document.documentElement.style.setProperty("--mobile-height", `${viewport?.height ?? window.innerHeight}px`);
        document.documentElement.style.setProperty("--mobile-top", `${viewport?.offsetTop ?? 0}px`);
      });
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--mobile-height");
      document.documentElement.style.removeProperty("--mobile-top");
    };
  }, []);
}
