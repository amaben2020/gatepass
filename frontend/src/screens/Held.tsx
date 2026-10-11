import { useEffect, useState } from 'react';
import { api } from '../api';
import { clock, naira, useCountdown } from '../hooks';
import type { EventSummary, HoldResult } from '../types';

type Props = {
  event: EventSummary;
  hold: HoldResult;
  onChange: () => void;
  onPay: () => Promise<void>;
  onReleased: () => void;
  onExpired: () => void;
  onError: (err: unknown) => void;
};

export function Held({ event, hold, onChange, onPay, onReleased, onExpired, onError }: Props) {
  const left = useCountdown(hold.expiresAt);
  const [busy, setBusy] = useState(false);
  const labels = hold.seats.map((s) => s.label);

  // The Redis locks expire on their own at the same moment; this only updates the screen.
  useEffect(() => {
    if (left === 0) onExpired();
  }, [left]);

  const release = async () => {
    setBusy(true);
    try {
      await api('DELETE', `/events/${event.id}/seats/hold`);
      onReleased();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen center">
      <div className="check" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </div>
      <h1 className="title">
        {labels.join(' and ')} {labels.length === 1 ? 'is' : 'are'} yours for {left === null ? '–' : clock(left)}
      </h1>
      <p className="muted">Pay before the timer ends or the seats go back on sale.</p>
      <ul className="lines">
        {hold.seats.map((s) => (
          <li key={s.id} className="row between">
            <span>Seat {s.label}</span>
            <span className="mono">{naira(s.price)}</span>
          </li>
        ))}
        <li className="row between total">
          <span>Total</span>
          <span className="mono">{naira(hold.total)}</span>
        </li>
      </ul>
      <div className="spacer" />
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onPay();
          setBusy(false);
        }}
      >
        Pay {naira(hold.total)}
      </button>
      <p className="muted small">Creates the order and a Stripe PaymentIntent (test mode).</p>
      <div className="row gap">
        <button className="btn ghost grow" onClick={onChange} disabled={busy}>Change seats</button>
        <button className="btn ghost grow" onClick={release} disabled={busy}>Release seats</button>
      </div>
    </div>
  );
}
