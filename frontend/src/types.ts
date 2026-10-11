// Shapes returned by the backend. Money is always kobo (₦1 = 100).
export type User = { id: string; email: string };

export type EventSummary = { id: string; name: string; startsAt: string; status: 'draft' | 'on_sale' | 'sold_out' | 'ended' };

export type WaitingStatus =
  | { status: 'waiting'; position: number }
  | { status: 'admitted'; expiresAt: string }
  | { status: 'not_in_line' };

export type SeatStatus = 'available' | 'held' | 'yours' | 'sold';
export type Seat = { id: string; label: string; price: number; status: SeatStatus };

export type HoldResult = { seats: Omit<Seat, 'status'>[]; total: number; expiresAt: string };

export type DebugState = PipelineState & {
  keys: { waitingRoom: string; pass: string; hold: string };
  waitingCount: number;
  shoppingCount: number;
  seatLocksTotal: number;
  you: { userId: string; position: number | null; passTtlSeconds: number | null; held: { label: string; ttlSeconds: number }[] };
};

export type OrderCreated = { orderId: string; clientSecret: string; amount: number; currency: string; holdExpiresAt: string };

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refund_due' | 'refunded';
export type OrderView = {
  id: string;
  status: OrderStatus;
  amount: number;
  currency: string;
  seats: string[];
  tickets: { code: string; seatLabel: string }[];
};

export type PipelineState = {
  order: { id: string; status: OrderStatus; amount: number; paymentIntentId: string | null } | null;
  webhooks: { id: string; type: string; receivedAt: string }[];
  paymentsQueue: { waiting: number; inFlight: number } | null;
  paymentsDlq: { waiting: number; inFlight: number } | null;
};
