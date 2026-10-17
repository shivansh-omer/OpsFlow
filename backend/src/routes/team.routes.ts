import { Router } from 'express';
import { getMyTeams, getTeamMembers } from '../controllers/team.controller';
import { authenticate } from '../middleware/authenticate';
import { requireTeamMembership } from '../middleware/teamAuth';

const router = Router();

// All team routes require authentication
router.use(authenticate);

// Return teams the authenticated user belongs to
router.get('/', getMyTeams);

// Return team members - strictly requires membership in the target team
router.get('/:teamId/members', requireTeamMembership(), getTeamMembers);

export const teamRouter = router;
