import {
  ActivityAction,
  Prisma,
  Role,
  WorkItemStatus,
} from '@prisma/client';
import { prisma } from '../config/db';
import { ApiError } from '../utils/errors';

export enum WorkflowAction {
  START_PROGRESS = 'START_PROGRESS',
  SUBMIT_FOR_APPROVAL = 'SUBMIT_FOR_APPROVAL',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  CLOSE = 'CLOSE',
  CANCEL = 'CANCEL',
}

export interface TransitionInput {
  action?: WorkflowAction;
  targetStatus?: WorkItemStatus;
  version: number;
  reason?: string;
  comment?: string;
}

export interface TransitionRule {
  from: WorkItemStatus;
  to: WorkItemStatus;
  action: WorkflowAction;
  allowedRoles: Role[];
  activityAction: ActivityAction;
  requiresReason?: boolean;
  validate?: (context: {
    userId: string;
    userRole: Role;
    assigneeId: string | null;
    reason?: string;
  }) => void;
}

export const WORKFLOW_RULES: Record<WorkflowAction, TransitionRule> = {
  [WorkflowAction.START_PROGRESS]: {
    from: WorkItemStatus.OPEN,
    to: WorkItemStatus.IN_PROGRESS,
    action: WorkflowAction.START_PROGRESS,
    allowedRoles: [Role.MEMBER, Role.LEAD, Role.ADMIN],
    activityAction: ActivityAction.STATUS_CHANGED,
    validate: ({ assigneeId }) => {
      if (!assigneeId) {
        throw ApiError.conflict(
          'Cannot start progress on an unassigned work item. Please claim or assign the item first.'
        );
      }
    },
  },
  [WorkflowAction.SUBMIT_FOR_APPROVAL]: {
    from: WorkItemStatus.IN_PROGRESS,
    to: WorkItemStatus.AWAITING_APPROVAL,
    action: WorkflowAction.SUBMIT_FOR_APPROVAL,
    allowedRoles: [Role.MEMBER, Role.LEAD, Role.ADMIN],
    activityAction: ActivityAction.STATUS_CHANGED,
    validate: ({ userId, userRole, assigneeId }) => {
      if (userRole === Role.MEMBER && assigneeId !== userId) {
        throw ApiError.forbidden(
          'Only the assigned team member (or a Lead/Admin) can submit this item for approval'
        );
      }
    },
  },
  [WorkflowAction.APPROVE]: {
    from: WorkItemStatus.AWAITING_APPROVAL,
    to: WorkItemStatus.RESOLVED,
    action: WorkflowAction.APPROVE,
    allowedRoles: [Role.LEAD, Role.ADMIN],
    activityAction: ActivityAction.APPROVED,
    validate: ({ userId, assigneeId }) => {
      // Separation of Duties: Submitter / Assignee cannot approve their own item
      if (assigneeId === userId) {
        throw ApiError.forbidden(
          'Separation of duties: You cannot approve a work item assigned to yourself. Another Lead or Admin must review and approve this item.'
        );
      }
    },
  },
  [WorkflowAction.REJECT]: {
    from: WorkItemStatus.AWAITING_APPROVAL,
    to: WorkItemStatus.IN_PROGRESS,
    action: WorkflowAction.REJECT,
    allowedRoles: [Role.LEAD, Role.ADMIN],
    activityAction: ActivityAction.REJECTED,
    requiresReason: true,
    validate: ({ reason }) => {
      if (!reason || reason.trim().length < 3) {
        throw ApiError.badRequest('A meaningful rejection reason (at least 3 characters) is required');
      }
    },
  },
  [WorkflowAction.CLOSE]: {
    from: WorkItemStatus.RESOLVED,
    to: WorkItemStatus.CLOSED,
    action: WorkflowAction.CLOSE,
    allowedRoles: [Role.LEAD, Role.ADMIN],
    activityAction: ActivityAction.STATUS_CHANGED,
  },
  [WorkflowAction.CANCEL]: {
    from: WorkItemStatus.OPEN,
    to: WorkItemStatus.CLOSED,
    action: WorkflowAction.CANCEL,
    allowedRoles: [Role.LEAD, Role.ADMIN],
    activityAction: ActivityAction.STATUS_CHANGED,
    requiresReason: true,
    validate: ({ reason }) => {
      if (!reason || reason.trim().length < 3) {
        throw ApiError.badRequest('A cancellation reason (at least 3 characters) is required');
      }
    },
  },
};

/**
 * Resolves WorkflowAction from either explicit action or targetStatus
 */
export function resolveAction(
  currentStatus: WorkItemStatus,
  input: TransitionInput
): WorkflowAction {
  if (input.action) {
    return input.action;
  }

  if (input.targetStatus) {
    for (const rule of Object.values(WORKFLOW_RULES)) {
      if (rule.from === currentStatus && rule.to === input.targetStatus) {
        return rule.action;
      }
    }
  }

  throw ApiError.conflict(
    `Invalid status transition: Cannot transition from status '${currentStatus}' with supplied parameters`
  );
}

export class WorkflowService {
  /**
   * Executes a workflow state machine transition atomically with optimistic locking
   */
  async executeTransition(id: string, userId: string, input: TransitionInput) {
    const existing = await prisma.workItem.findUnique({
      where: { id },
      include: { team: true },
    });

    if (!existing) {
      throw ApiError.notFound('Work item not found');
    }

    // 1. Check Team Membership
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

    // 2. Resolve & Validate Workflow Action against Current Status
    const action = resolveAction(existing.status, input);
    const rule = WORKFLOW_RULES[action];

    if (!rule || rule.from !== existing.status) {
      throw ApiError.conflict(
        `Invalid status transition: Cannot execute action '${action}' when item is in status '${existing.status}'`
      );
    }

    // 3. Verify Role Authorization
    if (!rule.allowedRoles.includes(membership.role)) {
      throw ApiError.forbidden(
        `Access denied: Your role (${membership.role}) does not have permission to execute action '${action}'. Required: ${rule.allowedRoles.join(', ')}`
      );
    }

    // 4. Custom Rule Validations (Reason checks, self-approval guards, assignee checks)
    if (rule.validate) {
      rule.validate({
        userId,
        userRole: membership.role,
        assigneeId: existing.assigneeId,
        reason: input.reason,
      });
    }

    // 5. Execute Atomic Transition in Prisma Transaction
    return prisma.$transaction(async (tx) => {
      const updateResult = await tx.workItem.updateMany({
        where: {
          id,
          version: input.version,
          status: rule.from, // Guarantees status hasn't concurrently changed
        },
        data: {
          status: rule.to,
          version: { increment: 1 },
        },
      });

      if (updateResult.count === 0) {
        const current = await tx.workItem.findUnique({ where: { id } });
        if (!current) throw ApiError.notFound('Work item not found');

        if (current.version !== input.version) {
          throw ApiError.conflict(
            `Conflict: Work item was modified by another operation. Expected version ${input.version}, but current version is ${current.version}. Please refresh.`
          );
        }

        if (current.status !== rule.from) {
          throw ApiError.conflict(
            `Conflict: Work item status changed to '${current.status}'. Transition '${action}' is no longer permitted.`
          );
        }

        throw ApiError.conflict('Workflow transition could not be applied');
      }

      // 6. Record Append-Only Activity Log in the SAME Transaction
      const metadata: Record<string, unknown> = {
        action,
        previousStatus: rule.from,
        newStatus: rule.to,
        previousVersion: input.version,
        newVersion: input.version + 1,
      };

      if (input.reason) {
        metadata.reason = input.reason.trim();
      }

      if (input.comment) {
        metadata.comment = input.comment.trim();
      }

      await tx.activityLog.create({
        data: {
          workItemId: id,
          actorId: userId,
          action: rule.activityAction,
          oldValue: rule.from,
          newValue: rule.to,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });

      // 7. If optional comment was included, persist it atomically
      if (input.comment && input.comment.trim().length > 0) {
        await tx.comment.create({
          data: {
            workItemId: id,
            authorId: userId,
            content: input.comment.trim(),
          },
        });
      }

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

export const workflowService = new WorkflowService();
