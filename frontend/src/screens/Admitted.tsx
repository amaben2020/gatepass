import { useEffect } from 'react';
import { clock, useCountdown } from '../hooks';

type Props = { passExpiresAt: string; onChoose: () => void; onExpired: () => void };

export function Admitted({ passExpiresAt, onChoose, onExpired }: Props) {
  const left = useCountdown(passExpiresAt);
  useEffect(() => {
    if (left === 0) onExpired();
  }, [left]);

  return (
    <div className="screen center">
      <div className="check" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </div>
      <h1 className="title">It's your turn</h1>
      <p className="muted">You're through the waiting room. Choose your seats before your pass runs out.</p>
      <div className="timer">
        <span className="muted small">Pass expires in</span>
        <span className="mono big">{left === null ? '–' : clock(left)}</span>
      </div>
      <div className="spacer" />
      <button className="btn primary" onClick={onChoose}>Choose seats</button>
    </div>
  );
}
