import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePass } from '../../middleware/require-pass.js';
import { OrdersController } from '../orders/orders.controller.js';
import { EventsController } from './events.controller.js';

const router = Router();

// Public: what's on.
router.get('/', EventsController.list);

// Waiting room: logged in is enough.
router.post('/:eventId/waiting-room', requireAuth, EventsController.joinWaitingRoom);
router.get('/:eventId/waiting-room', requireAuth, EventsController.waitingRoomStatus);

// Seat selection: only admitted users (requireAuth first: requirePass needs the userId).
router.get('/:eventId/seats', requireAuth, requirePass, EventsController.seatMap);
router.post('/:eventId/seats/hold', requireAuth, requirePass, EventsController.holdSeats);
// Pay: turns your held seats into an order + Stripe PaymentIntent.
router.post('/:eventId/orders', requireAuth, requirePass, OrdersController.create);
// No pass needed to give seats back.
router.delete('/:eventId/seats/hold', requireAuth, EventsController.releaseSeats);

export default router;
