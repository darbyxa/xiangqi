import { useEffect, useState } from 'react';

/** A ticking clock for countdowns. Only runs while `active`. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [active, intervalMs]);
  return now;
}
