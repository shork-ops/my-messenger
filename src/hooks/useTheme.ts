import { useEffect, useState } from "react";
import { DEFAULT_TEXT_SIZE, resolveTextSize } from "../lib/textSize";

export function useTheme() {
  const [theme, setTheme] = useState(() => window.localStorage.getItem("nexus-theme") || "yellow");
  const [textSize, setTextSize] = useState(
    () => window.localStorage.getItem("nexus-text-size") || DEFAULT_TEXT_SIZE
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("nexus-theme", theme);
  }, [theme]);

  // The scale is a root custom property, so one write reaches every rule that
  // opted into it instead of a prop threaded through the tree.
  useEffect(() => {
    document.documentElement.style.setProperty("--text-scale", String(resolveTextSize(textSize).scale));
    window.localStorage.setItem("nexus-text-size", textSize);
  }, [textSize]);

  return { theme, setTheme, textSize, setTextSize };
}
