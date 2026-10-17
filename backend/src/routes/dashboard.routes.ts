import { Router } from 'express';
import { getDashboard, getDashboardQuerySchema } from '../controllers/dashboard.controller';
import { authenticate } from '../middleware/authenticate';
import { validateRequest } from '../middleware/validateRequest';

const router = Router();

// Dashboard strictly requires authentication
router.use(authenticate);

// GET /api/v1/dashboard - Team-scoped operational dashboard & queues
router.get('/', validateRequest({ query: getDashboardQuerySchema }), getDashboard);

export const dashboardRouter = router;
