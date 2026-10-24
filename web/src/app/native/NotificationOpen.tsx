import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { notifier } from '../reminders/notifier.ts';

/** A tap on one of the Android app's notifications opens what it is about (ADR-0017). */
export function NotificationOpen() {
  const navigate = useNavigate();
  useEffect(() => notifier().onOpen?.((url) => void navigate(url)), [navigate]);
  return null;
}
