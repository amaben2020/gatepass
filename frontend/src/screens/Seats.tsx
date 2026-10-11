import { useState } from 'react';
import { api } from '../api';
import { clock, naira, useCountdown, usePoll } from '../hooks';
import type { EventSummary, HoldResult, Seat } from '../types';

type Props = {
  event: EventSummary;
  passExpiresAt: string | null;
  onHeld: (hold: HoldResult) => void;
  onError: (err: unknown) => void;
};

export function Seats({ event, passExpiresAt, onHeld, onError }: Props) {
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const passLeft = useCountdown(passExpiresAt);

  // Refresh every 3 s so seats other people hold or buy turn grey without a reload.
  usePoll(
    async () => {
      const first = seats === null;
      try {
        const map = await api<{ seats: Seat[] }>('GET', `/events/${event.id}/seats`, undefined, { poll: !first });
        setSeats(map.seats);
        // Coming back from "Change seats": start with what you already hold.
        if (first) setSelected(map.seats.filter((s) => s.status === 'yours').map((s) => s.id));
      } catch (err) {
        onError(err); // NO_PASS here sends the user back to the line (handled in App)
      }
    },
    3000,
  );

  const toggle = (seat: Seat) =>
    setSelected((cur) => (cur.includes(seat.id) ? cur.filter((id) => id !== seat.id) : [...cur, seat.id]));

  const hold = async () => {
    setBusy(true);
    try {
      onHeld(await api<HoldResult>('POST', `/events/${event.id}/seats/hold`, { seatIds: selected }));
    } catch (err) {
      onError(err); // SEAT_TAKEN, TOO_MANY_SEATS, ... shown as a message
      const map = await api<{ seats: Seat[] }>('GET', `/events/${event.id}/seats`).catch(() => null);
      if (map) setSeats(map.seats);
    } finally {
      setBusy(false);
    }
  };

  const rows = groupByRow(seats ?? []);
  const picked = (seats ?? []).filter((s) => selected.includes(s.id));
  const total = picked.reduce((sum, s) => sum + s.price, 0);

  return (
    <div className="screen">
      <div className="row between">
        <h1 className="title small-title">Pick your seats</h1>
        {passLeft !== null && <span className="mono muted small">pass {clock(passLeft)}</span>}
      </div>
      <div className="stage">STAGE</div>

      <div className="seatmap" role="group" aria-label="Seat map">
        {rows.map(([row, rowSeats]) => (
          <div key={row} className="seat-row">
            <span className="row-label">{row}</span>
            {rowSeats.map((seat) => {
              const isSelected = selected.includes(seat.id);
              const blocked = seat.status === 'sold' || seat.status === 'held';
              return (
                <button
                  key={seat.id}
                  className={`seat ${seat.status} ${isSelected ? 'selected' : ''}`}
                  disabled={blocked}
                  onClick={() => toggle(seat)}
                  aria-label={`${seat.label}, ${seat.status}, ${naira(seat.price)}`}
                  aria-pressed={isSelected}
                  title={`${seat.label} · ${naira(seat.price)} · ${seat.status}`}
                />
              );
            })}
          </div>
        ))}
        {!seats && <p className="muted">Loading seats…</p>}
      </div>

      <div className="legend">
        <span><i className="seat available" /> free</span>
        <span><i className="seat selected" /> picked</span>
        <span><i className="seat yours" /> yours</span>
        <span><i className="seat held" /> held</span>
        <span><i className="seat sold" /> sold</span>
      </div>
      <p className="muted small">A–B {naira(5_000_000)} · C–F {naira(2_000_000)} · G–J {naira(1_000_000)}. Up to 4 seats (the server enforces it).</p>

      <div className="spacer" />
      <div className="summary">
        <span>{picked.length ? picked.map((s) => s.label).join(', ') : 'No seats picked'}</span>
        <span className="mono">{naira(total)}</span>
      </div>
      <button className="btn primary" disabled={busy || selected.length === 0} onClick={hold}>
        Hold {selected.length || ''} seat{selected.length === 1 ? '' : 's'}
      </button>
    </div>
  );
}

// "C10" sorts after "C9": the server already orders seats, this just splits them into rows.
function groupByRow(seats: Seat[]) {
  const rows = new Map<string, Seat[]>();
  for (const seat of seats) {
    const row = seat.label[0];
    rows.set(row, [...(rows.get(row) ?? []), seat]);
  }
  return [...rows.entries()];
}
