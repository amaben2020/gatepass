import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { DevPanel } from './components/DevPanel';
import { Admitted } from './screens/Admitted';
import { Events } from './screens/Events';
import { Held } from './screens/Held';
import { Login } from './screens/Login';
import { Pay } from './screens/Pay';
import { Processing } from './screens/Processing';
import { Seats } from './screens/Seats';
import { Tickets } from './screens/Tickets';
import { WaitingRoom } from './screens/WaitingRoom';
import type { EventSummary, HoldResult, OrderCreated, OrderView, User } from './types';

type Screen = 'loading' | 'login' | 'events' | 'waiting' | 'admitted' | 'seats' | 'held' | 'pay' | 'processing' | 'tickets';
type Toast = { id: number; kind: 'error' | 'info'; text: string; code?: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [passExpiresAt, setPassExpiresAt] = useState<string | null>(null);
  const [hold, setHold] = useState<HoldResult | null>(null);
  const [order, setOrder] = useState<OrderCreated | null>(null);
  const [result, setResult] = useState<OrderView | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Already logged in? The session cookie answers that.
  useEffect(() => {
    api<{ user: User }>('GET', '/auth/me')
      .then(({ user }) => {
        setUser(user);
        setScreen('events');
      })
      .catch(() => setScreen('login'));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const notify = (kind: Toast['kind'], text: string, code?: string) => setToast({ id: Date.now(), kind, text, code });

  // One place that turns backend errors into messages, and the two codes that change screens.
  const onError = (err: unknown) => {
    if (!(err instanceof ApiError)) return notify('error', 'Network error: is the backend running on :4000?');
    notify('error', err.message, err.code);
    if (err.code === 'NO_PASS') {
      setHold(null);
      setScreen('waiting'); // rejoins the line
    } else if (err.code === 'HOLD_EXPIRED' || err.code === 'NO_HOLD') {
      setHold(null);
      setScreen('seats');
    } else if (err.status === 401) {
      setUser(null);
      setScreen('login');
    }
  };

  const logout = async () => {
    await api('POST', '/auth/logout').catch(() => {});
    setUser(null);
    setEvent(null);
    setHold(null);
    setScreen('login');
  };

  return (
    <div className="layout">
      <main className="phone" aria-live="polite">
        <header className="phone-header">
          <span className="brand">GATEPASS</span>
          {user && (
            <span className="row gap small">
              <span className="muted">{user.email}</span>
              <button className="link" onClick={logout}>Log out</button>
            </span>
          )}
        </header>

        {toast && (
          <div className={`toast ${toast.kind}`} role="status" key={toast.id}>
            {toast.code && <span className="code">{toast.code}</span>}
            <span>{toast.text}</span>
          </div>
        )}

        {screen === 'loading' && <div className="screen center"><p className="muted">Loading…</p></div>}

        {screen === 'login' && (
          <Login
            onError={onError}
            onLoggedIn={(u) => {
              setUser(u);
              setScreen('events');
            }}
          />
        )}

        {screen === 'events' && (
          <Events
            onError={onError}
            onPick={(e) => {
              setEvent(e);
              setScreen('waiting');
            }}
          />
        )}

        {screen === 'waiting' && event && (
          <WaitingRoom
            event={event}
            onError={onError}
            onLeave={() => setScreen('events')}
            onAdmitted={(expiresAt) => {
              setPassExpiresAt(expiresAt);
              setScreen('admitted');
            }}
          />
        )}

        {screen === 'admitted' && passExpiresAt && (
          <Admitted
            passExpiresAt={passExpiresAt}
            onChoose={() => setScreen('seats')}
            onExpired={() => {
              notify('info', 'Your pass ran out. Back in the line.');
              setScreen('waiting');
            }}
          />
        )}

        {screen === 'seats' && event && (
          <Seats
            event={event}
            passExpiresAt={passExpiresAt}
            onError={onError}
            onHeld={(h) => {
              setHold(h);
              setScreen('held');
            }}
          />
        )}

        {screen === 'held' && event && hold && (
          <Held
            event={event}
            hold={hold}
            onError={onError}
            onChange={() => setScreen('seats')}
            onPay={async () => {
              try {
                setOrder(await api<OrderCreated>('POST', `/events/${event.id}/orders`));
                setScreen('pay');
              } catch (err) {
                onError(err);
              }
            }}
            onReleased={() => {
              notify('info', 'Seats released.');
              setHold(null);
              setScreen('seats');
            }}
            onExpired={() => {
              notify('info', 'Your hold expired. The seats are back on sale.');
              setHold(null);
              setScreen('seats');
            }}
          />
        )}
        {screen === 'pay' && order && (
          <Pay order={order} onBack={() => setScreen('held')} onPaid={() => setScreen('processing')} />
        )}

        {screen === 'processing' && order && (
          <Processing
            orderId={order.orderId}
            onError={onError}
            onDone={(o) => {
              setResult(o);
              setHold(null);
              setScreen('tickets');
            }}
          />
        )}

        {screen === 'tickets' && event && result && (
          <Tickets
            event={event}
            order={result}
            onDone={() => {
              setOrder(null);
              setResult(null);
              setScreen('events');
            }}
          />
        )}
      </main>

      <DevPanel event={event} loggedIn={!!user} />
    </div>
  );
}
