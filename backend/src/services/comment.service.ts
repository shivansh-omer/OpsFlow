import { ActivityAction } from '@prisma/client';
import { prisma } from '../config/db';
import { ApiError } from '../utils/errors';

export class CommentService {
  /**
   * Adds a comment to a work item and atomically logs the COMMENTED activity event
   */
  async addComment(workItemId: string, userId: string, content: string) {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length === 0) {
      throw ApiError.badRequest('Comment content cannot be empty');
    }
    if (trimmed.length > 2000) {
      throw ApiError.badRequest('Comment exceeds maximum allowed length of 2000 characters');
    }

    const workItem = await prisma.workItem.findUnique({
      where: { id: workItemId },
      select: { teamId: true },
    });

    if (!workItem) {
      throw ApiError.notFound('Work item not found');
    }

    // Verify team membership (any role in the team may comment)
    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: workItem.teamId,
          userId,
        },
      },
    });

    if (!membership) {
      throw ApiError.forbidden('You do not have access to comment on this work item');
    }

    return prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: {
          workItemId,
          authorId: userId,
          content: trimmed,
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      });

      // Record comment activity in timeline
      await tx.activityLog.create({
        data: {
          workItemId,
          actorId: userId,
          action: ActivityAction.COMMENTED,
          metadata: {
            commentId: comment.id,
            snippet: trimmed.slice(0, 80),
          },
        },
      });

      return comment;
    });
  }

  /**
   * Retrieves comments for a work item in chronological order
   */
  async listComments(workItemId: string, userId: string) {
    const workItem = await prisma.workItem.findUnique({
      where: { id: workItemId },
      select: { teamId: true },
    });

    if (!workItem) {
      throw ApiError.notFound('Work item not found');
    }

    // Verify team membership
    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: workItem.teamId,
          userId,
        },
      },
    });

    if (!membership) {
      throw ApiError.forbidden('You do not have access to view comments on this work item');
    }

    const comments = await prisma.comment.findMany({
      where: { workItemId },
      orderBy: { createdAt: 'asc' },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    return comments;
  }
}

export const commentService = new CommentService();
