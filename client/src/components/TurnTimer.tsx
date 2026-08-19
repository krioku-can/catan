import { useEffect, useState } from 'react';

export const TURN_SECONDS = 70;
export const ROBBER_BONUS_SECONDS = 30;

export default function TurnTimer({
  deadline,
  paused,
  pausedRemainingMs,
}: {
  deadline: number | null;
  paused?: boolean;
  pausedRemainingMs?: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (paused || deadline == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [deadline, paused]);

  const ms = paused
    ? (pausedRemainingMs ?? 0)
    : deadline == null
      ? null
      : deadline - now;

  if (ms == null) return null;

  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const label = `${m}:${s.toString().padStart(2, '0')}`;
  const urgency = total <= 10 ? 'danger' : total <= 20 ? 'warn' : 'ok';

  return (
    <div
      className={`turn-timer turn-timer-${urgency}${paused ? ' turn-timer-paused' : ''}`}
      role="timer"
      aria-live="polite"
      aria-label={paused ? `Turn timer paused at ${label}` : `${label} left`}
    >
      <span className="turn-timer-digits">{label}</span>
      <span className="turn-timer-hint">{paused ? 'paused' : total <= 10 ? 'hurry' : 'turn'}</span>
    </div>
  );
}
