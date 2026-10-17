import { prisma } from '../config/db';
import { ApiError } from '../utils/errors';

export class ActivityService {
  /**
   * Retrieves paginated activity events for a work item with stable deterministic ordering
   */
  async listActivities(workItemId: string, userId: string, page = 1, limit = 20) {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(100, Math.max(1, limit));
    const skip = (validPage - 1) * validLimit;

    const workItem = await prisma.workItem.findUnique({
      where: { id: workItemId },
      select: { teamId: true },
    });

    if (!workItem) {
      throw ApiError.notFound('Work item not found');
    }

    // Verify team-level access
    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: workItem.teamId,
          userId,
        },
      },
    });

    if (!membership) {
      throw ApiError.forbidden('You do not have access to view this work item activity history');
    }

    const where = { workItemId };

    const [totalItems, activities] = await prisma.$transaction([
      prisma.activityLog.count({ where }),
      prisma.activityLog.findMany({
        where,
        skip,
        take: validLimit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // Deterministic ordering
        include: {
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(totalItems / validLimit) || 1;

    return {
      activities,
      pagination: {
        page: validPage,
        limit: validLimit,
        totalItems,
        totalPages,
      },
    };
  }
}

export const activityService = new ActivityService();
