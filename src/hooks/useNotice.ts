import { useCallback, useEffect, useRef, useState } from "react";

export function useNotice() {
  const [notice, setNotice] = useState("");
  const timeoutRef = useRef<number | null>(null);

  const notify = useCallback((label: string) => {
    setNotice(label);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setNotice("");
      timeoutRef.current = null;
    }, 2600);
  }, []);

  const clearNotice = useCallback(() => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    setNotice("");
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
  }, []);

  return { notice, notify, clearNotice };
}
