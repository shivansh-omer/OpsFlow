import { Router } from 'express';
import {
  login,
  demoLogin,
  getMe,
  loginSchema,
  demoLoginSchema,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { validateRequest } from '../middleware/validateRequest';

const router = Router();

router.post('/login', validateRequest({ body: loginSchema }), login);
router.post('/demo-login', validateRequest({ body: demoLoginSchema }), demoLogin);
router.get('/me', authenticate, getMe);

export const authRouter = router;
