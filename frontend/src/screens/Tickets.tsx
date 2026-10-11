import { naira } from '../hooks';
import type { EventSummary, OrderView } from '../types';

type Props = { event: EventSummary; order: OrderView; onDone: () => void };

export function Tickets({ event, order, onDone }: Props) {
  if (order.status !== 'paid') {
    const why =
      order.status === 'refunded'
        ? 'Your payment went through after your seat hold ran out, so the seats may have gone to someone else. You have been refunded in full.'
        : 'The payment did not go through. No money was taken and your seats were released.';
    return (
      <div className="screen center">
        <h1 className="title">{order.status === 'refunded' ? 'Refunded' : 'Payment failed'}</h1>
        <p className="muted">{why}</p>
        <p className="mono muted small">order {order.id.slice(0, 8)} · {order.status}</p>
        <div className="spacer" />
        <button className="btn primary" onClick={onDone}>Back to events</button>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1 className="title">Your tickets</h1>
      <p className="muted">{event.name} · {naira(order.amount)} paid</p>
      {order.tickets.map((t) => (
        <article key={t.code} className="ticket">
          <div>
            <div className="muted small">Seat</div>
            <div className="ticket-seat">{t.seatLabel}</div>
          </div>
          <div className="ticket-code">
            <div className="muted small">Show at the gate</div>
            <div className="mono">{t.code}</div>
          </div>
        </article>
      ))}
      <div className="spacer" />
      <button className="btn ghost" onClick={onDone}>Back to events</button>
    </div>
  );
}
