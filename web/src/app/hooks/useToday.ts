import { useEffect, useState } from 'react';
import { localTimeZone, todayIn } from '../../core/dates.ts';

/** The current time, refreshed every `intervalMs` (render-safe alternative to Date.now()). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Today's local date, updated when the day changes. */
export function useToday(timeZone: string = localTimeZone()): string {
  const [today, setToday] = useState(() => todayIn(timeZone, Date.now()));
  useEffect(() => {
    const timer = setInterval(() => setToday(todayIn(timeZone, Date.now())), 60_000);
    return () => clearInterval(timer);
  }, [timeZone]);
  return today;
}
