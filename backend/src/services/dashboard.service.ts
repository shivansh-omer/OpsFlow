import { Prisma, Role, WorkItemPriority, WorkItemStatus } from '@prisma/client';
import { prisma } from '../config/db';
import { ApiError } from '../utils/errors';

export class DashboardService {
  /**
   * Generates team-scoped operational metrics and focused work item queues
   * strictly filtered by the authenticated caller's team memberships.
   */
  async getDashboardData(userId: string, requestedTeamId?: string) {
    // 1. Resolve caller's team memberships
    const memberships = await prisma.teamMember.findMany({
      where: { userId },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    const userTeamIds = memberships.map((m) => m.teamId);

    // 2. IDOR Prevention: If a specific teamId was requested, enforce membership
    if (requestedTeamId) {
      if (!userTeamIds.includes(requestedTeamId)) {
        throw ApiError.forbidden('You do not have access to view dashboard metrics for this team');
      }
    }

    const targetTeamIds = requestedTeamId ? [requestedTeamId] : userTeamIds;

    // Fast-path: if user belongs to no teams, return empty dashboard
    if (targetTeamIds.length === 0) {
      return {
        summary: {
          totalActive: 0,
          byStatus: {},
          byPriority: {},
        },
        assignedToMe: { count: 0, items: [] },
        unassignedUrgent: { count: 0, items: [] },
        awaitingMyApproval: { count: 0, items: [] },
        overdue: { count: 0, items: [] },
        recentActivity: [],
      };
    }

    // Teams where caller has approval authority (LEAD or ADMIN)
    const approvalEligibleTeamIds = memberships
      .filter((m) => m.role === Role.LEAD || m.role === Role.ADMIN)
      .map((m) => m.teamId)
      .filter((tid) => targetTeamIds.includes(tid));

    const now = new Date();

    const itemSelect = {
      id: true,
      title: true,
      description: true,
      type: true,
      priority: true,
      status: true,
      version: true,
      dueDate: true,
      createdAt: true,
      updatedAt: true,
      team: { select: { id: true, name: true, slug: true } },
      creator: { select: { id: true, name: true, email: true } },
      assignee: { select: { id: true, name: true, email: true } },
    };

    // Execute efficient database aggregation and queue queries in a transaction
    const [
      statusCounts,
      priorityCounts,
      totalActive,
      assignedCount,
      assignedItems,
      unassignedUrgentCount,
      unassignedUrgentItems,
      awaitingApprovalCount,
      awaitingApprovalItems,
      overdueCount,
      overdueItems,
      recentActivity,
    ] = await prisma.$transaction([
      // A. Status Distribution
      prisma.workItem.groupBy({
        by: ['status'],
        where: { teamId: { in: targetTeamIds } },
        _count: { id: true },
        orderBy: { status: 'asc' },
      }),

      // B. Priority Distribution (Active non-closed items)
      prisma.workItem.groupBy({
        by: ['priority'],
        where: {
          teamId: { in: targetTeamIds },
          status: { not: WorkItemStatus.CLOSED },
        },
        _count: { id: true },
        orderBy: { priority: 'asc' },
      }),

      // C. Total Active Work Items
      prisma.workItem.count({
        where: {
          teamId: { in: targetTeamIds },
          status: { not: WorkItemStatus.CLOSED },
        },
      }),

      // D. Assigned to Me
      prisma.workItem.count({
        where: {
          teamId: { in: targetTeamIds },
          assigneeId: userId,
          status: { not: WorkItemStatus.CLOSED },
        },
      }),
      prisma.workItem.findMany({
        where: {
          teamId: { in: targetTeamIds },
          assigneeId: userId,
          status: { not: WorkItemStatus.CLOSED },
        },
        take: 5,
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { updatedAt: 'desc' }],
        select: itemSelect,
      }),

      // E. Unassigned Urgent
      prisma.workItem.count({
        where: {
          teamId: { in: targetTeamIds },
          assigneeId: null,
          priority: WorkItemPriority.URGENT,
          status: { not: WorkItemStatus.CLOSED },
        },
      }),
      prisma.workItem.findMany({
        where: {
          teamId: { in: targetTeamIds },
          assigneeId: null,
          priority: WorkItemPriority.URGENT,
          status: { not: WorkItemStatus.CLOSED },
        },
        take: 5,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        select: itemSelect,
      }),

      // F. Awaiting My Approval
      prisma.workItem.count({
        where: {
          teamId: { in: approvalEligibleTeamIds },
          status: WorkItemStatus.AWAITING_APPROVAL,
        },
      }),
      prisma.workItem.findMany({
        where: {
          teamId: { in: approvalEligibleTeamIds },
          status: WorkItemStatus.AWAITING_APPROVAL,
        },
        take: 5,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        select: itemSelect,
      }),

      // G. Overdue Work Items (dueDate < now AND not in terminal status RESOLVED/CLOSED)
      prisma.workItem.count({
        where: {
          teamId: { in: targetTeamIds },
          dueDate: { lt: now },
          status: { notIn: [WorkItemStatus.RESOLVED, WorkItemStatus.CLOSED] },
        },
      }),
      prisma.workItem.findMany({
        where: {
          teamId: { in: targetTeamIds },
          dueDate: { lt: now },
          status: { notIn: [WorkItemStatus.RESOLVED, WorkItemStatus.CLOSED] },
        },
        take: 5,
        orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
        select: itemSelect,
      }),

      // H. Recent Activity Feed across caller's teams
      prisma.activityLog.findMany({
        where: {
          workItem: { teamId: { in: targetTeamIds } },
        },
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
          workItem: {
            select: {
              id: true,
              title: true,
              team: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      }),
    ]);

    // Map group-by rows into dictionaries
    const byStatus = statusCounts.reduce((acc, row) => {
      acc[row.status] = (row._count as { id?: number })?.id ?? 0;
      return acc;
    }, {} as Record<string, number>);

    const byPriority = priorityCounts.reduce((acc, row) => {
      acc[row.priority] = (row._count as { id?: number })?.id ?? 0;
      return acc;
    }, {} as Record<string, number>);

    return {
      summary: {
        totalActive,
        byStatus,
        byPriority,
      },
      assignedToMe: {
        count: assignedCount,
        items: assignedItems,
      },
      unassignedUrgent: {
        count: unassignedUrgentCount,
        items: unassignedUrgentItems,
      },
      awaitingMyApproval: {
        count: awaitingApprovalCount,
        items: awaitingApprovalItems,
      },
      overdue: {
        count: overdueCount,
        items: overdueItems,
      },
      recentActivity,
    };
  }
}

export const dashboardService = new DashboardService();
