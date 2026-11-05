import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { readItem, writeItem } from "../lib/safeStorage";

/** Key changes never write the previous account's value into the next account. */
export function useStoredState<T>(key: string | null, parse: (raw: string | null) => T, serialize: (value: T) => string = JSON.stringify): [T, Dispatch<SetStateAction<T>>] {
  const initial = useMemo(() => parse(key ? readItem(key) : null), [key, parse]);
  const [snapshot, setSnapshot] = useState(() => ({key,value:initial}));
  const currentKey = useRef(key);
  currentKey.current = key;
  const value = snapshot.key === key ? snapshot.value : initial;
  useEffect(() => {setSnapshot(current => current.key === key ? current : {key,value:initial});},[key,initial]);
  useEffect(() => {if (key && snapshot.key === key) writeItem(key,serialize(snapshot.value));},[key,snapshot,serialize]);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    if (currentKey.current !== key) return;
    setSnapshot(current => {
      const previous = current.key === key ? current.value : initial;
      return {key,value:typeof update === "function" ? (update as (value:T)=>T)(previous) : update};
    });
  },[key,initial]);
  return [value,setValue];
}

/** Undefined denotes the demo namespace; null means identity is not known yet. */
export function accountStorageKey(base: string, accountId: string | null | undefined): string | null {
  return accountId === undefined ? base : accountId ? `${base}:${accountId}` : null;
}
