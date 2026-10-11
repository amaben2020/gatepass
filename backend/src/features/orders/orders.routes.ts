import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import { OrdersController } from './orders.controller.js';

const router = Router();

// Creating an order lives under /api/events/:eventId/orders (it needs the pass); see events.routes.ts.
router.get('/:orderId', requireAuth, OrdersController.get);

export default router;
