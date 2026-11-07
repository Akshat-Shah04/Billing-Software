import { useCallback, useEffect, useState } from "react";
import { apiBlob } from "./api";

/** A URL the browser can show for the firm's logo (or null if there is none). `version` reloads it when it changes. */
export function useLogoUrl(hasLogo: boolean | undefined, version: number | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hasLogo) {
      setUrl(null);
      return;
    }
    let current = true;
    let made: string | null = null;
    apiBlob("/settings/logo")
      .then((blob) => {
        if (!current) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => current && setUrl(null));
    return () => {
      current = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [hasLogo, version]);
  return url;
}

/** Returns `value` only after it has stopped changing for `ms` (so we do not search on every keystroke). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Loads data whenever `key` changes. Ignores answers that arrive after a newer request started. */
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    load()
      .then((d) => {
        if (current) {
          setData(d);
          setError("");
        }
      })
      .catch((e: Error) => current && setError(e.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
