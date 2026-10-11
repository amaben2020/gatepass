import { useEffect, useState } from 'react';
import { api, clearLog, subscribeLog, type LogEntry } from '../api';
import { clock, usePoll } from '../hooks';
import type { DebugState, EventSummary } from '../types';

type Props = { event: EventSummary | null; loggedIn: boolean };

export function DevPanel({ event, loggedIn }: Props) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showPolls, setShowPolls] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [state, setState] = useState<DebugState | null>(null);

  useEffect(() => subscribeLog(setLog), []);

  // The dev-only /api/debug endpoint: the Redis keys behind what the phone is showing.
  usePoll(
    async () => {
      if (!event) return;
      setState(await api<DebugState>('GET', `/debug/events/${event.id}`, undefined, { silent: true }));
    },
    1000,
    loggedIn && !!event,
  );

  const visible = showPolls ? log : log.filter((e) => !e.poll);

  return (
    <aside className="devpanel" aria-label="Under the hood">
      <h2 className="dev-title">Under the hood</h2>

      <section className="dev-card">
        <h3>Redis right now {event && <span className="dim">· {event.name}</span>}</h3>
        {!event || !state ? (
          <p className="dim">Pick an event to watch its keys.</p>
        ) : (
          <dl className="stats">
            <div><dt>In line</dt><dd>{state.waitingCount}</dd><code>ZCARD {state.keys.waitingRoom}</code></div>
            <div><dt>Shopping</dt><dd>{state.shoppingCount}<span className="dim">/100</span></dd><code>ZCOUNT shoppers now +inf</code></div>
            <div><dt>Your position</dt><dd>{state.you.position ?? '–'}</dd><code>ZRANK … {short(state.you.userId)}</code></div>
            <div><dt>Your pass</dt><dd>{state.you.passTtlSeconds ? clock(state.you.passTtlSeconds) : 'none'}</dd><code>PTTL {state.keys.pass.replace(state.you.userId, short(state.you.userId))}</code></div>
            <div className="wide">
              <dt>Your held seats</dt>
              <dd>{state.you.held.length ? state.you.held.map((h) => `${h.label} (${clock(h.ttlSeconds)})`).join('  ') : 'none'}</dd>
              <code>seat:{'{'}event{'}'}:&lt;seatId&gt; = your userId, EX 600 · {state.seatLocksTotal} lock(s) on this event</code>
            </div>
          </dl>
        )}
      </section>

      <section className="dev-card">
        <h3>Payment pipeline <span className="dim">· server-to-server, never in the browser log</span></h3>
        {!state ? (
          <p className="dim">Pick an event to watch it.</p>
        ) : (
          <dl className="stats">
            <div><dt>Your latest order</dt><dd className={`order-${state.order?.status ?? 'none'}`}>{state.order?.status ?? 'none'}</dd><code>{state.order ? `orders.${short(state.order.id)} · ${state.order.paymentIntentId ?? 'no PaymentIntent'}` : 'POST /events/:id/orders'}</code></div>
            <div><dt>Payments queue</dt><dd>{state.paymentsQueue ? `${state.paymentsQueue.waiting} / ${state.paymentsQueue.inFlight}` : '–'}<span className="dim"> waiting / in flight</span></dd><code>gatepass-payments.fifo · DLQ {state.paymentsDlq?.waiting ?? 0}</code></div>
            <div className="wide">
              <dt>Stripe webhooks received (webhook_events)</dt>
              <dd className="webhooks">
                {state.webhooks.length === 0 ? <span className="dim">none yet: is `stripe listen` running?</span> : state.webhooks.map((w) => (
                  <span key={w.id} className="mono"><span className="dim">{new Date(w.receivedAt).toLocaleTimeString()}</span> {w.type} <span className="dim">{w.id.slice(0, 14)}…</span></span>
                ))}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="dev-card grow">
        <div className="row between">
          <h3>Requests</h3>
          <div className="row gap">
            <label className="dim small"><input type="checkbox" checked={showPolls} onChange={(e) => setShowPolls(e.target.checked)} /> show polling</label>
            <button className="link" onClick={clearLog}>clear</button>
          </div>
        </div>
        {visible.length === 0 && <p className="dim">Nothing yet. Every API call shows up here.</p>}
        <ol className="log">
          {visible.map((e) => {
            const code = (e.response as { code?: string } | null)?.code;
            return (
              <li key={e.id}>
                <button className="log-row" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                  <span className="mono dim">{e.at.toLocaleTimeString()}</span>
                  <span className={`method ${e.method}`}>{e.method}</span>
                  <span className="mono path">{e.path.replace(/[0-9a-f-]{36}/g, (id) => short(id))}</span>
                  <span className={`status s${String(e.status)[0]}`}>{e.status}</span>
                  {code && <span className="code">{code}</span>}
                  <span className="mono dim">{e.ms}ms</span>
                </button>
                {open === e.id && (
                  <div className="log-body">
                    {e.request !== undefined && (<><div className="dim small">request body</div><pre>{JSON.stringify(e.request, null, 2)}</pre></>)}
                    <div className="dim small">response</div>
                    <pre>{JSON.stringify(e.response, null, 2)}</pre>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </aside>
  );
}

const short = (id: string) => `${id.slice(0, 8)}…`;
