import express, { Router } from 'express';
import { PaymentsService } from './payments.service.js';

const router = Router();

// Mounted in app.ts BEFORE express.json(): signature checking needs the exact bytes Stripe sent.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  res.json(await PaymentsService.handleWebhook(req.body as Buffer, req.header('stripe-signature')));
});

export default router;
