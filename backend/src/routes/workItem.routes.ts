import { Router } from 'express';
import {
  createWorkItem,
  listWorkItems,
  getWorkItem,
  updateWorkItem,
  claimWorkItem,
  transitionWorkItem,
  getWorkItemActivity,
  addComment,
  getComments,
  createWorkItemSchema,
  listWorkItemsQuerySchema,
  updateWorkItemSchema,
  claimWorkItemSchema,
  transitionWorkItemSchema,
  getWorkItemActivityQuerySchema,
  addCommentSchema,
} from '../controllers/workItem.controller';
import { authenticate } from '../middleware/authenticate';
import { validateRequest } from '../middleware/validateRequest';

const router = Router();

// All work item routes require authenticated session
router.use(authenticate);

// Create new work item (Supports Idempotency-Key header)
router.post('/', validateRequest({ body: createWorkItemSchema }), createWorkItem);

// List accessible work items with server-side filters & pagination
router.get('/', validateRequest({ query: listWorkItemsQuerySchema }), listWorkItems);

// Retrieve single work item (enforces team boundary)
router.get('/:id', getWorkItem);

// Update work item (enforces Optimistic Concurrency Control via `version`)
router.patch('/:id', validateRequest({ body: updateWorkItemSchema }), updateWorkItem);

// Atomically claim unassigned work item
router.post('/:id/claim', validateRequest({ body: claimWorkItemSchema }), claimWorkItem);

// Execute workflow state machine transition (enforces roles, self-approval guards, atomic updates)
router.post('/:id/transitions', validateRequest({ body: transitionWorkItemSchema }), transitionWorkItem);

// Retrieve append-only activity timeline for a work item
router.get('/:id/activity', validateRequest({ query: getWorkItemActivityQuerySchema }), getWorkItemActivity);

// Add a comment to a work item
router.post('/:id/comments', validateRequest({ body: addCommentSchema }), addComment);

// Retrieve comments for a work item
router.get('/:id/comments', getComments);

export const workItemRouter = router;
