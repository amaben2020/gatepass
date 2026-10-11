import { useEffect, useRef, useState } from 'react';

// Seconds left until `expiresAt` (an ISO timestamp from the server), ticking every second.
export function useCountdown(expiresAt: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!expiresAt) return null;
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
}

// Runs `fn` now and then every `ms`, stopping when the component unmounts.
export function usePoll(fn: () => Promise<void> | void, ms: number, enabled = true) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      if (alive) await Promise.resolve(latest.current()).catch(() => {});
    };
    tick();
    const timer = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [ms, enabled]);
}

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
export const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;
