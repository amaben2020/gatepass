import { useEffect, useState } from 'react';
import { api } from '../api';
import { usePoll } from '../hooks';
import type { EventSummary, WaitingStatus } from '../types';

type Props = {
  event: EventSummary;
  onAdmitted: (expiresAt: string) => void;
  onError: (err: unknown) => void;
  onLeave: () => void;
};

export function WaitingRoom({ event, onAdmitted, onError, onLeave }: Props) {
  const [status, setStatus] = useState<WaitingStatus | null>(null);
  const [joined, setJoined] = useState(false);

  const handle = (s: WaitingStatus) => {
    setStatus(s);
    if (s.status === 'admitted') onAdmitted(s.expiresAt);
  };

  // Join once (safe to repeat: the backend just returns the current status).
  useEffect(() => {
    api<WaitingStatus>('POST', `/events/${event.id}/waiting-room`)
      .then((s) => {
        handle(s);
        setJoined(true);
      })
      .catch((err) => {
        onError(err);
        onLeave();
      });
  }, [event.id]);

  // Then ask "is it my turn?" every 2 s. The gatekeeper, not this page, decides when.
  usePoll(
    async () => handle(await api<WaitingStatus>('GET', `/events/${event.id}/waiting-room`, undefined, { poll: true })),
    2000,
    joined,
  );

  return (
    <div className="screen center">
      <p className="eyebrow">Waiting room</p>
      {status?.status === 'waiting' ? (
        <>
          <p className="muted">You're number</p>
          <div className="big-number">{status.position.toLocaleString()}</div>
          <p className="muted">in line for {event.name}</p>
        </>
      ) : (
        <p className="muted">Joining the line…</p>
      )}
      <div className="spinner" aria-hidden="true" />
      <p className="muted small">Keep this page open. When it's your turn you'll move on automatically. Your place is kept if you refresh.</p>
      <div className="spacer" />
      <button className="btn ghost" onClick={onLeave}>Back to events</button>
    </div>
  );
}
