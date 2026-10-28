import { useEffect, useState } from "react";

export function useTheme() {
  const [theme, setTheme] = useState(() => window.localStorage.getItem("nexus-theme") || "yellow");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("nexus-theme", theme);
  }, [theme]);

  return { theme, setTheme };
}
