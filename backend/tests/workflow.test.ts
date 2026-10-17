import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/config/db';
import { generateToken } from '../src/utils/jwt';
import { ActivityAction, Role, WorkItemPriority, WorkItemStatus, WorkItemType } from '@prisma/client';
import { WorkflowAction } from '../src/services/workflow.service';

describe('Workflow State Machine & Gatekeeper Approvals (/api/v1/work-items/:id/transitions)', () => {
  let platformTeamId: string;
  let incidentTeamId: string;

  let adminToken: string;
  let platformLeadToken: string;
  let incidentLeadToken: string;
  let devMemberToken: string;
  let juniorMemberToken: string;
  let auditorViewerToken: string;

  let adminId: string;
  let platformLeadId: string;
  let incidentLeadId: string;
  let devMemberId: string;
  let juniorMemberId: string;

  beforeAll(async () => {
    const platformTeam = await prisma.team.findUniqueOrThrow({ where: { slug: 'platform-ops' } });
    const incidentTeam = await prisma.team.findUniqueOrThrow({ where: { slug: 'incident-response' } });

    platformTeamId = platformTeam.id;
    incidentTeamId = incidentTeam.id;

    const [admin, platformLead, incidentLead, devMember, juniorMember, auditorViewer] =
      await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { email: 'admin@opsflow.io' } }),
        prisma.user.findUniqueOrThrow({ where: { email: 'lead.platform@opsflow.io' } }),
        prisma.user.findUniqueOrThrow({ where: { email: 'lead.incident@opsflow.io' } }),
        prisma.user.findUniqueOrThrow({ where: { email: 'member.dev@opsflow.io' } }),
        prisma.user.findUniqueOrThrow({ where: { email: 'member.junior@opsflow.io' } }),
        prisma.user.findUniqueOrThrow({ where: { email: 'viewer.audit@opsflow.io' } }),
      ]);

    adminId = admin.id;
    platformLeadId = platformLead.id;
    incidentLeadId = incidentLead.id;
    devMemberId = devMember.id;
    juniorMemberId = juniorMember.id;

    adminToken = generateToken({ userId: admin.id, email: admin.email });
    platformLeadToken = generateToken({ userId: platformLead.id, email: platformLead.email });
    incidentLeadToken = generateToken({ userId: incidentLead.id, email: incidentLead.email });
    devMemberToken = generateToken({ userId: devMember.id, email: devMember.email });
    juniorMemberToken = generateToken({ userId: juniorMember.id, email: juniorMember.email });
    auditorViewerToken = generateToken({ userId: auditorViewer.id, email: auditorViewer.email });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Permitted Lifecycle State Transitions', () => {
    it('executes the complete permitted lifecycle: OPEN -> IN_PROGRESS -> AWAITING_APPROVAL -> RESOLVED -> CLOSED', async () => {
      // 1. Create an initial work item assigned to devMember
      const item = await prisma.workItem.create({
        data: {
          title: 'Lifecycle Verification Ticket',
          description: 'Testing standard end-to-end promotion pipeline.',
          type: WorkItemType.TASK,
          priority: WorkItemPriority.HIGH,
          status: WorkItemStatus.OPEN,
          teamId: platformTeamId,
          creatorId: devMemberId,
          assigneeId: devMemberId,
          version: 1,
        },
      });

      // Step 1: OPEN -> IN_PROGRESS (by assigned member)
      const res1 = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({
          action: WorkflowAction.START_PROGRESS,
          version: 1,
        });

      expect(res1.status).toBe(200);
      expect(res1.body.data.workItem.status).toBe(WorkItemStatus.IN_PROGRESS);
      expect(res1.body.data.workItem.version).toBe(2);

      // Step 2: IN_PROGRESS -> AWAITING_APPROVAL (by assignee)
      const res2 = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({
          action: WorkflowAction.SUBMIT_FOR_APPROVAL,
          version: 2,
          comment: 'Implementation finished and tests green. Ready for review.',
        });

      expect(res2.status).toBe(200);
      expect(res2.body.data.workItem.status).toBe(WorkItemStatus.AWAITING_APPROVAL);
      expect(res2.body.data.workItem.version).toBe(3);

      // Step 3: AWAITING_APPROVAL -> RESOLVED (by platformLead - non-assignee)
      const res3 = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          action: WorkflowAction.APPROVE,
          version: 3,
        });

      expect(res3.status).toBe(200);
      expect(res3.body.data.workItem.status).toBe(WorkItemStatus.RESOLVED);
      expect(res3.body.data.workItem.version).toBe(4);

      // Step 4: RESOLVED -> CLOSED (by platformLead)
      const res4 = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          action: WorkflowAction.CLOSE,
          version: 4,
        });

      expect(res4.status).toBe(200);
      expect(res4.body.data.workItem.status).toBe(WorkItemStatus.CLOSED);
      expect(res4.body.data.workItem.version).toBe(5);

      // Verify activity logs: APPROVED event recorded
      const approvedLog = await prisma.activityLog.findFirst({
        where: { workItemId: item.id, action: ActivityAction.APPROVED },
      });
      expect(approvedLog).not.toBeNull();
      expect(approvedLog?.actorId).toBe(platformLeadId);
    });

    it('supports OPEN -> CLOSED cancellation by Lead/Admin with required reason', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Obsolete Feature Request',
          description: 'No longer needed after architectural change.',
          status: WorkItemStatus.OPEN,
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 1,
        },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          action: WorkflowAction.CANCEL,
          version: 1,
          reason: 'Duplicate of ticket PROD-102.',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.workItem.status).toBe(WorkItemStatus.CLOSED);
      expect(res.body.data.workItem.version).toBe(2);
    });

    it('rejects OPEN -> CLOSED cancellation if reason is missing', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Cancelled without reason',
          description: 'Missing reason test',
          status: WorkItemStatus.OPEN,
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 1,
        },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          action: WorkflowAction.CANCEL,
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('cancellation reason');
    });
  });

  describe('2. Prohibited Transitions (State Machine Invariants)', () => {
    it('rejects illegal transition from OPEN to RESOLVED with 409 Conflict', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Bypass attempt from OPEN to RESOLVED',
          description: 'Should be blocked by state machine',
          status: WorkItemStatus.OPEN,
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 1,
        },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          targetStatus: WorkItemStatus.RESOLVED,
          version: 1,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('Invalid status transition');
    });

    it('rejects illegal transition from IN_PROGRESS to CLOSED directly with 409 Conflict', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Premature close attempt',
          description: 'Must go through approval and resolution',
          status: WorkItemStatus.IN_PROGRESS,
          teamId: platformTeamId,
          creatorId: devMemberId,
          assigneeId: devMemberId,
          version: 1,
        },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          action: WorkflowAction.CLOSE,
          version: 1,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('Invalid status transition');
    });

    it('rejects any transition on a CLOSED work item with 409 Conflict', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Finalized closed ticket',
          description: 'Closed tickets cannot be modified',
          status: WorkItemStatus.CLOSED,
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 1,
        },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          action: WorkflowAction.START_PROGRESS,
          version: 1,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('Invalid status transition');
    });
  });

  describe('3. Gatekeeper Approvals, Rejections & Self-Approval Prevention', () => {
    it('denies approval attempt by non-Lead/Admin members with 403 Forbidden', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Under Review',
          description: 'Requires Lead/Admin approval',
          status: WorkItemStatus.AWAITING_APPROVAL,
          teamId: platformTeamId,
          creatorId: devMemberId,
          assigneeId: devMemberId,
          version: 1,
        },
      });

      // juniorMember is a MEMBER, not a Lead or Admin
      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${juniorMemberToken}`)
        .send({
          action: WorkflowAction.APPROVE,
          version: 1,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('MEMBER');
      expect(res.body.error.message).toContain('permission to execute action');
    });

    it('denies approval attempt by Viewers with 403 Forbidden', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Viewer Approval Attempt',
          description: 'Viewers cannot approve',
          status: WorkItemStatus.AWAITING_APPROVAL,
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 1,
        },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${auditorViewerToken}`)
        .send({
          action: WorkflowAction.APPROVE,
          version: 1,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('VIEWER');
    });

    it('strictly PREVENTS self-approval when Lead is the ticket assignee (Separation of Duties)', async () => {
      // PlatformLead assigned the task to herself
      const item = await prisma.workItem.create({
        data: {
          title: 'Lead Self-Assigned Production Change',
          description: 'Lead cannot unilaterally sign off on own assigned work item.',
          status: WorkItemStatus.AWAITING_APPROVAL,
          teamId: platformTeamId,
          creatorId: platformLeadId,
          assigneeId: platformLeadId,
          version: 1,
        },
      });

      // PlatformLead tries to self-approve
      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          action: WorkflowAction.APPROVE,
          version: 1,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('Separation of duties');
      expect(res.body.error.message).toContain('cannot approve a work item assigned to yourself');

      // However, peer Admin CAN approve it
      const adminApprovalRes = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: WorkflowAction.APPROVE,
          version: 1,
        });

      expect(adminApprovalRes.status).toBe(200);
      expect(adminApprovalRes.body.data.workItem.status).toBe(WorkItemStatus.RESOLVED);
    });

    it('executes rejection with required reason, transitioning AWAITING_APPROVAL -> IN_PROGRESS', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Code lacking unit test coverage',
          description: 'Awaiting Lead review',
          status: WorkItemStatus.AWAITING_APPROVAL,
          teamId: platformTeamId,
          creatorId: devMemberId,
          assigneeId: devMemberId,
          version: 1,
        },
      });

      // 1. Rejection without reason fails with 400
      const resNoReason = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          action: WorkflowAction.REJECT,
          version: 1,
        });

      expect(resNoReason.status).toBe(400);
      expect(resNoReason.body.error.message).toContain('rejection reason');

      // 2. Rejection with reason succeeds
      const resWithReason = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          action: WorkflowAction.REJECT,
          version: 1,
          reason: 'Unit test coverage below 80% threshold. Please add integration tests for edge cases.',
        });

      expect(resWithReason.status).toBe(200);
      expect(resWithReason.body.data.workItem.status).toBe(WorkItemStatus.IN_PROGRESS);
      expect(resWithReason.body.data.workItem.version).toBe(2);

      // Verify REJECTED activity event was recorded with reason
      const rejectedLog = await prisma.activityLog.findFirst({
        where: { workItemId: item.id, action: ActivityAction.REJECTED },
      });
      expect(rejectedLog).not.toBeNull();
      expect(rejectedLog?.metadata).toMatchObject({
        reason: expect.stringContaining('Unit test coverage below 80%'),
      });
    });
  });

  describe('4. Cross-Team Access & Concurrency Safety', () => {
    it('denies transition with 403 when user belongs to a different team (Cross-team denial)', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Platform Team Isolated Ticket',
          description: 'Incident lead should not have access',
          status: WorkItemStatus.OPEN,
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 1,
        },
      });

      // incidentLead belongs to incident-response, NOT platform-ops
      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${incidentLeadToken}`)
        .send({
          action: WorkflowAction.CANCEL,
          version: 1,
          reason: 'Attempting cross-team cancellation',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('do not have access');
    });

    it('rejects stale-version workflow transition with 409 Conflict', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Stale Version Transition Ticket',
          description: 'Currently at version 2',
          status: WorkItemStatus.RESOLVED,
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 2,
        },
      });

      // Submit stale version 1
      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          action: WorkflowAction.CLOSE,
          version: 1,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('modified by another operation');
      expect(res.body.error.message).toContain('Expected version 1, but current version is 2');
    });

    it('executes two simultaneous conflicting transitions: exactly ONE succeeds (200) and ONE fails (409)', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Simultaneous Review Decision Race',
          description: 'Two Leads making competing decisions at same second',
          status: WorkItemStatus.AWAITING_APPROVAL,
          teamId: platformTeamId,
          creatorId: devMemberId,
          assigneeId: devMemberId,
          version: 1,
        },
      });

      // Two overlapping requests: one approves, one rejects
      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/v1/work-items/${item.id}/transitions`)
          .set('Authorization', `Bearer ${platformLeadToken}`)
          .send({
            action: WorkflowAction.APPROVE,
            version: 1,
          }),
        request(app)
          .post(`/api/v1/work-items/${item.id}/transitions`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            action: WorkflowAction.REJECT,
            version: 1,
            reason: 'Conflicting reject decision',
          }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      // Database integrity: version is exactly 2, and exactly 1 transition log exists
      const dbItem = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(dbItem.version).toBe(2);

      const transitionLogs = await prisma.activityLog.findMany({
        where: {
          workItemId: item.id,
          action: { in: [ActivityAction.APPROVED, ActivityAction.REJECTED] },
        },
      });
      expect(transitionLogs.length).toBe(1);
    });

    it('verifies failed transitions do NOT create false success activity records', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'False Success Verification Ticket',
          description: 'No log should be created on failure',
          status: WorkItemStatus.OPEN,
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 1,
        },
      });

      const countBefore = await prisma.activityLog.count({
        where: { workItemId: item.id },
      });

      // Attempt invalid transition
      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/transitions`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          action: WorkflowAction.CLOSE,
          version: 1,
        });

      expect(res.status).toBe(409);

      const countAfter = await prisma.activityLog.count({
        where: { workItemId: item.id },
      });

      expect(countAfter).toBe(countBefore);
    });
  });
});
