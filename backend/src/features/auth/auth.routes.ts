import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import { AuthController } from './auth.controller.js';

const router = Router();

router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.post('/logout', requireAuth, AuthController.logout);
router.get('/me', requireAuth, AuthController.me);

export default router;
