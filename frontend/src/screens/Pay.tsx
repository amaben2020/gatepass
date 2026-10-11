import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useState, type FormEvent } from 'react';
import { clock, naira, useCountdown } from '../hooks';
import type { OrderCreated } from '../types';

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
// Loaded once for the whole app. Stripe.js must come from Stripe's own servers (PCI rules), so this fetches a script.
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

type Props = { order: OrderCreated; onPaid: () => void; onBack: () => void };

export function Pay({ order, onPaid, onBack }: Props) {
  if (!stripePromise) {
    return (
      <div className="screen center">
        <h1 className="title">Stripe isn't set up</h1>
        <p className="muted">Add VITE_STRIPE_PUBLISHABLE_KEY=pk_test_… to frontend/.env, then restart npm run dev.</p>
        <div className="spacer" />
        <button className="btn ghost" onClick={onBack}>Back</button>
      </div>
    );
  }

  // The clientSecret ties this form to the PaymentIntent our server created for this order.
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: order.clientSecret,
        appearance: { theme: 'stripe', variables: { colorPrimary: '#1F6F72', borderRadius: '12px', fontFamily: 'IBM Plex Sans, system-ui, sans-serif' } },
      }}
    >
      <PayForm order={order} onPaid={onPaid} onBack={onBack} />
    </Elements>
  );
}

function PayForm({ order, onPaid, onBack }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(order.holdExpiresAt);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    // Card details go from this form straight to Stripe; our server never sees them.
    // Success here means Stripe accepted the payment. Tickets come later, when the webhook reaches our worker.
    const { error } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: window.location.href },
    });
    if (error) {
      setError(error.message ?? 'Payment failed');
      setBusy(false);
      return;
    }
    onPaid();
  };

  return (
    <form className="screen" onSubmit={submit}>
      <div className="row between">
        <h1 className="title small-title">Pay {naira(order.amount)}</h1>
        {left !== null && <span className="mono muted small">seats {clock(left)}</span>}
      </div>
      <p className="muted small">
        Test card <span className="mono">4242 4242 4242 4242</span>, any future date, any CVC. Declined: <span className="mono">4000 0000 0000 0002</span>.
      </p>
      <PaymentElement />
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="spacer" />
      <button className="btn primary" disabled={!stripe || busy}>{busy ? 'Paying…' : `Pay ${naira(order.amount)}`}</button>
      <button type="button" className="btn ghost" onClick={onBack} disabled={busy}>Back to my seats</button>
    </form>
  );
}
