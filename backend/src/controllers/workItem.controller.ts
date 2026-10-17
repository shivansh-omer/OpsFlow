import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { WorkItemPriority, WorkItemStatus, WorkItemType } from '@prisma/client';
import { workItemService } from '../services/workItem.service';
import { validateIdempotencyKey } from '../utils/idempotency';
import { ApiError } from '../utils/errors';

export const createWorkItemSchema = z
  .object({
    title: z.string().min(3, 'Title must be at least 3 characters long').max(200),
    description: z.string().min(1, 'Description is required').max(5000),
    type: z.nativeEnum(WorkItemType).optional(),
    priority: z.nativeEnum(WorkItemPriority).optional(),
    teamId: z.string().uuid('Invalid teamId format'),
    assigneeId: z.string().uuid('Invalid assigneeId format').nullable().optional(),
    dueDate: z.string().datetime().nullable().optional(),
  })
  .strict('Unknown or protected fields are not allowed in create payload');

export const updateWorkItemSchema = z
  .object({
    version: z.number().int().min(1, 'Current work item version is required for optimistic locking'),
    title: z.string().min(3).max(200).optional(),
    description: z.string().min(1).max(5000).optional(),
    type: z.nativeEnum(WorkItemType).optional(),
    priority: z.nativeEnum(WorkItemPriority).optional(),
    assigneeId: z.string().uuid('Invalid assigneeId format').nullable().optional(),
    dueDate: z.string().datetime().nullable().optional(),
  })
  .strict('Unknown or protected fields (e.g. id, creatorId, teamId, status) are not permitted in update payload');

export const listWorkItemsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  teamId: z.string().uuid().optional(),
  status: z.nativeEnum(WorkItemStatus).optional(),
  priority: z.nativeEnum(WorkItemPriority).optional(),
  type: z.nativeEnum(WorkItemType).optional(),
  assigneeId: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'priority', 'dueDate']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const claimWorkItemSchema = z
  .object({
    version: z.number().int().min(1).optional(),
  })
  .strict();

export async function createWorkItem(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required');
    }

    const rawKey = req.headers['idempotency-key'];
    const idempotencyKey = validateIdempotencyKey(
      Array.isArray(rawKey) ? rawKey[0] : rawKey
    );

    const result = await workItemService.createWorkItem(
      req.body,
      req.user.id,
      idempotencyKey,
      {
        method: req.method,
        path: req.originalUrl || req.path,
        rawBody: req.body,
      }
    );

    if (result.cached) {
      res.setHeader('X-Cache-Lookup', 'HIT');
    }

    res.status(result.statusCode).json(result.data);
  } catch (error) {
    next(error);
  }
}

export async function listWorkItems(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required');
    }

    const filters = req.query as unknown as z.infer<typeof listWorkItemsQuerySchema>;
    const result = await workItemService.listWorkItems(req.user.id, filters);

    res.status(200).json({
      success: true,
      data: result.workItems,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
}

export async function getWorkItem(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required');
    }

    const id = req.params.id as string;
    const workItem = await workItemService.getWorkItemById(id, req.user.id);

    res.status(200).json({
      success: true,
      data: { workItem },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateWorkItem(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required');
    }

    const id = req.params.id as string;
    const { version, ...updates } = req.body;

    const workItem = await workItemService.updateWorkItem(
      id,
      req.user.id,
      version,
      updates
    );

    res.status(200).json({
      success: true,
      data: { workItem },
    });
  } catch (error) {
    next(error);
  }
}

export async function claimWorkItem(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required');
    }

    const id = req.params.id as string;
    const clientVersion = req.body?.version as number | undefined;

    const workItem = await workItemService.claimWorkItem(
      id,
      req.user.id,
      clientVersion
    );

    res.status(200).json({
      success: true,
      data: { workItem },
    });
  } catch (error) {
    next(error);
  }
}
