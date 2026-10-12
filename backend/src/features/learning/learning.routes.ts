import express, { Request, Response, Router } from 'express';

import { LearningController } from './learning.controller.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePass } from '../../middleware/require-pass.js';
import { requireLearningPassMiddleware } from '../../middleware/learning/require-pass.js';

const router = Router();

// the gatekeeper moves users to a room and ensures they can select seats
router.post('/waiting-room', requireAuth, LearningController.joinWaitingRoom);

router.get(
  '/waiting-room',
  requireAuth,
  requireLearningPassMiddleware,
  LearningController.viewRoom,
);

export default router;
