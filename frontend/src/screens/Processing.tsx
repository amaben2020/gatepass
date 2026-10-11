import { useEffect, useState } from 'react';
import { api } from '../api';
import { usePoll } from '../hooks';
import type { OrderView } from '../types';

type Props = { orderId: string; onDone: (order: OrderView) => void; onError: (err: unknown) => void };

// Stripe has the money, but tickets don't exist until the webhook → SQS → worker chain finishes. Poll until it does.
export function Processing({ orderId, onDone, onError }: Props) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  usePoll(async () => {
    try {
      const order = await api<OrderView>('GET', `/orders/${orderId}`, undefined, { poll: true });
      if (order.status !== 'pending') onDone(order);
    } catch (err) {
      onError(err);
    }
  }, 1500);

  return (
    <div className="screen center">
      <div className="spinner big-spinner" aria-hidden="true" />
      <h1 className="title">Issuing your tickets</h1>
      <p className="muted">Stripe confirmed your payment. Our worker is writing your tickets.</p>
      <ol className="steps">
        <li>Stripe → <span className="mono">POST /api/payments/webhook</span></li>
        <li>webhook → SQS <span className="mono">gatepass-payments.fifo</span></li>
        <li>issue-ticket worker → one Postgres transaction</li>
      </ol>
      {seconds > 15 && (
        <p className="muted small">
          Taking a while? Webhooks reach your laptop only while <span className="mono">stripe listen</span> is running, and the
          issue-ticket worker must be up (<span className="mono">npm run doctor</span>).
        </p>
      )}
    </div>
  );
}
