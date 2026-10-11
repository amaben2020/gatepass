import { useEffect, useState } from 'react';
import { api } from '../api';
import type { EventSummary } from '../types';

type Props = { onPick: (event: EventSummary) => void; onError: (err: unknown) => void };

export function Events({ onPick, onError }: Props) {
  const [events, setEvents] = useState<EventSummary[] | null>(null);

  useEffect(() => {
    api<{ events: EventSummary[] }>('GET', '/events').then((r) => setEvents(r.events), onError);
  }, []);

  return (
    <div className="screen">
      <h1 className="title">What's on</h1>
      {!events && <p className="muted">Loading…</p>}
      {events?.map((event) => (
        <article key={event.id} className="card">
          <div className="row between">
            <h2 className="card-title">{event.name}</h2>
            <span className={`pill ${event.status}`}>{event.status.replace('_', ' ')}</span>
          </div>
          <p className="muted">
            {new Date(event.startsAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
          {/* Not-on-sale events stay clickable on purpose: the backend's NOT_ON_SALE message is worth seeing. */}
          <button className={`btn ${event.status === 'on_sale' ? 'primary' : 'ghost'}`} onClick={() => onPick(event)}>
            {event.status === 'on_sale' ? 'Get tickets' : 'Try anyway (not on sale)'}
          </button>
        </article>
      ))}
    </div>
  );
}
