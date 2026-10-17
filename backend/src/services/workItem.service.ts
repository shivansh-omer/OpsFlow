import {
  Prisma,
  Role,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemType,
  ActivityAction,
} from '@prisma/client';
import { prisma } from '../config/db';
import { ApiError } from '../utils/errors';
import { computeFingerprint } from '../utils/idempotency';

export interface CreateWorkItemInput {
  title: string;
  description: string;
  type?: WorkItemType;
  priority?: WorkItemPriority;
  teamId: string;
  assigneeId?: string | null;
  dueDate?: string | Date | null;
}

export interface UpdateWorkItemInput {
  title?: string;
  description?: string;
  type?: WorkItemType;
  priority?: WorkItemPriority;
  assigneeId?: string | null;
  dueDate?: string | Date | null;
}

export interface ListWorkItemsFilters {
  page?: number;
  limit?: number;
  teamId?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  type?: WorkItemType;
  assigneeId?: string;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'dueDate';
  sortOrder?: 'asc' | 'desc';
}

export interface IdempotencyRequestInfo {
  method: string;
  path: string;
  rawBody: unknown;
}

export class WorkItemService {
  /**
   * Creates a new work item with full authorization, input validation,
   * activity history recording, and atomic idempotency handling.
   */
  async createWorkItem(
    input: CreateWorkItemInput,
    creatorId: string,
    idempotencyKey?: string | null,
    requestInfo?: IdempotencyRequestInfo
  ) {
    // 1. Verify creator has permission in the target team (MEMBER, LEAD, ADMIN)
    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: input.teamId,
          userId: creatorId,
        },
      },
    });

    if (!membership) {
      throw ApiError.forbidden('You do not have access to create work items in this team');
    }

    if (membership.role === Role.VIEWER) {
      throw ApiError.forbidden('Viewers have read-only access and cannot create work items');
    }

    // 2. If an assignee is designated, verify they belong to the same team
    if (input.assigneeId) {
      const assigneeMembership = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: input.teamId,
            userId: input.assigneeId,
          },
        },
      });

      if (!assigneeMembership) {
        throw ApiError.badRequest('Assigned user must be an active member of the designated team');
      }
    }

    // 3. Idempotency Check
    let fingerprint = '';
    if (idempotencyKey && requestInfo) {
      fingerprint = computeFingerprint(requestInfo.method, requestInfo.path, requestInfo.rawBody);

      const existingRecord = await prisma.idempotencyRecord.findUnique({
        where: {
          key_userId: {
            key: idempotencyKey,
            userId: creatorId,
          },
        },
      });

      if (existingRecord) {
        if (existingRecord.fingerprint !== fingerprint) {
          throw ApiError.unprocessable(
            'Idempotency key has already been used with a different request payload'
          );
        }

        return {
          cached: true,
          statusCode: existingRecord.statusCode,
          data: existingRecord.responseBody,
        };
      }
    }

    // 4. Atomic Transaction: WorkItem + ActivityLog + IdempotencyRecord
    try {
      const result = await prisma.$transaction(async (tx) => {
        const workItem = await tx.workItem.create({
          data: {
            title: input.title.trim(),
            description: input.description.trim(),
            type: input.type || WorkItemType.TASK,
            priority: input.priority || WorkItemPriority.MEDIUM,
            status: WorkItemStatus.OPEN,
            teamId: input.teamId,
            creatorId,
            assigneeId: input.assigneeId || null,
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            version: 1,
          },
          include: {
            team: { select: { id: true, name: true, slug: true } },
            creator: { select: { id: true, name: true, email: true } },
            assignee: { select: { id: true, name: true, email: true } },
          },
        });

        // Activity event
        await tx.activityLog.create({
          data: {
            workItemId: workItem.id,
            actorId: creatorId,
            action: ActivityAction.CREATED,
            newValue: WorkItemStatus.OPEN,
            metadata: {
              type: workItem.type,
              priority: workItem.priority,
              teamId: workItem.teamId,
            },
          },
        });

        const responsePayload = {
          success: true,
          data: { workItem },
        };

        // Persist idempotency record if key was supplied
        if (idempotencyKey) {
          await tx.idempotencyRecord.create({
            data: {
              key: idempotencyKey,
              userId: creatorId,
              fingerprint,
              statusCode: 201,
              responseBody: responsePayload as unknown as Prisma.InputJsonValue,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h retention
            },
          });
        }

        return responsePayload;
      });

      return {
        cached: false,
        statusCode: 201,
        data: result,
      };
    } catch (error) {
      // Handle concurrent race condition for duplicate idempotency key
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        idempotencyKey
      ) {
        const existingRecord = await prisma.idempotencyRecord.findUnique({
          where: {
            key_userId: {
              key: idempotencyKey,
              userId: creatorId,
            },
          },
        });

        if (existingRecord) {
          if (existingRecord.fingerprint !== fingerprint) {
            throw ApiError.unprocessable(
              'Idempotency key has already been used with a different request payload'
            );
          }
          return {
            cached: true,
            statusCode: existingRecord.statusCode,
            data: existingRecord.responseBody,
          };
        }
      }

      throw error;
    }
  }

  /**
   * Retrieves paginated work items filtered strictly to teams the caller belongs to
   */
  async listWorkItems(userId: string, filters: ListWorkItemsFilters) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 10));
    const skip = (page - 1) * limit;

    // Get all teams the user has active membership in
    const userMemberships = await prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });

    const userTeamIds = userMemberships.map((m) => m.teamId);

    // If caller explicitly requested a team, verify membership (IDOR Prevention)
    if (filters.teamId) {
      if (!userTeamIds.includes(filters.teamId)) {
        throw ApiError.forbidden('You do not have access to view work items for this team');
      }
    }

    const where: Prisma.WorkItemWhereInput = {
      teamId: filters.teamId ? filters.teamId : { in: userTeamIds },
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.assigneeId === 'unassigned'
        ? { assigneeId: null }
        : filters.assigneeId
        ? { assigneeId: filters.assigneeId }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { title: { contains: filters.search, mode: 'insensitive' } },
              { description: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const sortBy = filters.sortBy || 'createdAt';
    const sortOrder = filters.sortOrder || 'desc';

    const [totalItems, workItems] = await prisma.$transaction([
      prisma.workItem.count({ where }),
      prisma.workItem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          team: { select: { id: true, name: true, slug: true } },
          creator: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    const totalPages = Math.ceil(totalItems / limit) || 1;

    return {
      workItems,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
      },
    };
  }

  /**
   * Retrieves a single work item, enforcing team-scoped authorization
   */
  async getWorkItemById(id: string, userId: string) {
    const workItem = await prisma.workItem.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true, slug: true } },
        creator: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
        _count: {
          select: {
            comments: true,
            activities: true,
          },
        },
      },
    });

    if (!workItem) {
      throw ApiError.notFound('Work item not found');
    }

    // Verify caller belongs to the item's team
    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: workItem.teamId,
          userId,
        },
      },
    });

    if (!membership) {
      throw ApiError.forbidden('You do not have access to view this work item');
    }

    return {
      ...workItem,
      myRole: membership.role,
    };
  }

  /**
   * Updates permitted work item fields using Optimistic Concurrency Control (OCC)
   */
  async updateWorkItem(
    id: string,
    userId: string,
    expectedVersion: number,
    updates: UpdateWorkItemInput
  ) {
    const existing = await prisma.workItem.findUnique({
      where: { id },
    });

    if (!existing) {
      throw ApiError.notFound('Work item not found');
    }

    // Team membership check
    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: existing.teamId,
          userId,
        },
      },
    });

    if (!membership) {
      throw ApiError.forbidden('You do not have access to modify work items in this team');
    }

    // Role-permission rules
    if (membership.role === Role.VIEWER) {
      throw ApiError.forbidden('Viewers have read-only permissions and cannot update work items');
    }

    if (membership.role === Role.MEMBER) {
      // Member can only edit their own assigned items
      if (existing.assigneeId !== userId) {
        throw ApiError.forbidden('Team members may only edit work items assigned to them');
      }

      // Member cannot reassign to another user
      if (updates.assigneeId !== undefined && updates.assigneeId !== userId && updates.assigneeId !== null) {
        throw ApiError.forbidden('Team members do not have permission to reassign work items');
      }
    }

    // Validate new assignee if provided
    if (updates.assigneeId) {
      const assigneeMembership = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: existing.teamId,
            userId: updates.assigneeId,
          },
        },
      });

      if (!assigneeMembership) {
        throw ApiError.badRequest('Assigned user must be a member of this team');
      }
    }

    // Atomic Optimistic Concurrency Check and Update
    return prisma.$transaction(async (tx) => {
      const result = await tx.workItem.updateMany({
        where: {
          id,
          version: expectedVersion,
        },
        data: {
          ...(updates.title !== undefined ? { title: updates.title.trim() } : {}),
          ...(updates.description !== undefined ? { description: updates.description.trim() } : {}),
          ...(updates.type !== undefined ? { type: updates.type } : {}),
          ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
          ...(updates.dueDate !== undefined ? { dueDate: updates.dueDate ? new Date(updates.dueDate) : null } : {}),
          ...(updates.assigneeId !== undefined ? { assigneeId: updates.assigneeId } : {}),
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        const current = await tx.workItem.findUnique({ where: { id } });
        if (!current) throw ApiError.notFound('Work item not found');
        throw ApiError.conflict(
          `Conflict: Work item was modified by another operation. Expected version ${expectedVersion}, but current version is ${current.version}. Please refresh.`
        );
      }

      // Record Activity Event
      await tx.activityLog.create({
        data: {
          workItemId: id,
          actorId: userId,
          action: ActivityAction.UPDATED,
          metadata: {
            updatedFields: Object.keys(updates),
            previousVersion: expectedVersion,
            newVersion: expectedVersion + 1,
          },
        },
      });

      return tx.workItem.findUniqueOrThrow({
        where: { id },
        include: {
          team: { select: { id: true, name: true, slug: true } },
          creator: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
        },
      });
    });
  }

  /**
   * Atomically claims an unassigned work item for the authenticated caller
   */
  async claimWorkItem(id: string, userId: string, clientVersion?: number) {
    const existing = await prisma.workItem.findUnique({
      where: { id },
    });

    if (!existing) {
      throw ApiError.notFound('Work item not found');
    }

    // Team membership check
    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: existing.teamId,
          userId,
        },
      },
    });

    if (!membership) {
      throw ApiError.forbidden('You do not have access to work items in this team');
    }

    if (membership.role === Role.VIEWER) {
      throw ApiError.forbidden('Viewers cannot claim work items');
    }

    // Atomic conditional update ensuring assigneeId is null
    return prisma.$transaction(async (tx) => {
      const result = await tx.workItem.updateMany({
        where: {
          id,
          assigneeId: null,
          status: { in: [WorkItemStatus.OPEN, WorkItemStatus.IN_PROGRESS] },
          ...(clientVersion !== undefined ? { version: clientVersion } : {}),
        },
        data: {
          assigneeId: userId,
          status: WorkItemStatus.IN_PROGRESS,
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        const current = await tx.workItem.findUnique({ where: { id } });
        if (!current) throw ApiError.notFound('Work item not found');
        if (current.assigneeId !== null) {
          throw ApiError.conflict('Work item has already been claimed by another user');
        }
        if (clientVersion !== undefined && current.version !== clientVersion) {
          throw ApiError.conflict(
            `Conflict: Work item version mismatch. Expected version ${clientVersion}, current version is ${current.version}.`
          );
        }
        throw ApiError.conflict('Work item cannot be claimed in its current status');
      }

      // Record Activity Log
      await tx.activityLog.create({
        data: {
          workItemId: id,
          actorId: userId,
          action: ActivityAction.CLAIMED,
          oldValue: null,
          newValue: userId,
          metadata: {
            previousStatus: WorkItemStatus.OPEN,
            newStatus: WorkItemStatus.IN_PROGRESS,
          },
        },
      });

      return tx.workItem.findUniqueOrThrow({
        where: { id },
        include: {
          team: { select: { id: true, name: true, slug: true } },
          creator: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
        },
      });
    });
  }
}

export const workItemService = new WorkItemService();
