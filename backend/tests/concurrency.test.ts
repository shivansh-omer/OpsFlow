import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/config/db';
import { generateToken } from '../src/utils/jwt';
import { ActivityAction, WorkItemPriority, WorkItemStatus, WorkItemType } from '@prisma/client';

describe('Concurrency Engine (Atomic Claiming & Optimistic Locking)', () => {
  let platformTeamId: string;

  let devMemberToken: string;
  let juniorMemberToken: string;
  let platformLeadToken: string;
  let incidentLeadToken: string;
  let auditorViewerToken: string;

  let devMemberId: string;
  let juniorMemberId: string;

  beforeAll(async () => {
    const platformTeam = await prisma.team.findUniqueOrThrow({ where: { slug: 'platform-ops' } });
    platformTeamId = platformTeam.id;

    const [devMember, juniorMember, platformLead, incidentLead, auditorViewer] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: 'member.dev@opsflow.io' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'member.junior@opsflow.io' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'lead.platform@opsflow.io' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'lead.incident@opsflow.io' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'viewer.audit@opsflow.io' } }),
    ]);

    devMemberId = devMember.id;
    juniorMemberId = juniorMember.id;

    devMemberToken = generateToken({ userId: devMember.id, email: devMember.email });
    juniorMemberToken = generateToken({ userId: juniorMember.id, email: juniorMember.email });
    platformLeadToken = generateToken({ userId: platformLead.id, email: platformLead.email });
    incidentLeadToken = generateToken({ userId: incidentLead.id, email: incidentLead.email });
    auditorViewerToken = generateToken({ userId: auditorViewer.id, email: auditorViewer.email });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Atomic Task Claiming (Critical Behaviour A)', () => {
    it('executes two simultaneous claims on an unassigned item: exactly ONE succeeds (200) and ONE fails (409)', async () => {
      // 1. Create a pristine unassigned work item in platform-ops
      const item = await prisma.workItem.create({
        data: {
          title: 'High Load Incident: RabbitMQ Queue Backlog',
          description: 'Queue length exceeded 50,000 messages. Needs urgent consumer scaling.',
          type: WorkItemType.INCIDENT,
          priority: WorkItemPriority.URGENT,
          status: WorkItemStatus.OPEN,
          teamId: platformTeamId,
          creatorId: devMemberId,
          assigneeId: null,
          version: 1,
        },
      });

      // 2. Dispatch concurrent claim requests overlapping at the exact same moment
      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/v1/work-items/${item.id}/claim`)
          .set('Authorization', `Bearer ${devMemberToken}`)
          .send({ version: 1 }),
        request(app)
          .post(`/api/v1/work-items/${item.id}/claim`)
          .set('Authorization', `Bearer ${juniorMemberToken}`)
          .send({ version: 1 }),
      ]);

      const statuses = [res1.status, res2.status].sort();

      // Exactly one must succeed with 200, and one must conflict with 409
      expect(statuses).toEqual([200, 409]);

      const winnerRes = res1.status === 200 ? res1 : res2;
      const loserRes = res1.status === 409 ? res1 : res2;

      expect(winnerRes.body.success).toBe(true);
      expect(winnerRes.body.data.workItem.status).toBe(WorkItemStatus.IN_PROGRESS);
      expect(winnerRes.body.data.workItem.version).toBe(2);

      expect(loserRes.body.success).toBe(false);
      expect(loserRes.body.error.message).toContain('already been claimed');

      // 3. Database verification
      const dbItem = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(dbItem.version).toBe(2);
      expect(dbItem.status).toBe(WorkItemStatus.IN_PROGRESS);
      expect([devMemberId, juniorMemberId]).toContain(dbItem.assigneeId);

      // Verify activity logs: exactly ONE claim event was persisted
      const claimLogs = await prisma.activityLog.findMany({
        where: { workItemId: item.id, action: ActivityAction.CLAIMED },
      });
      expect(claimLogs.length).toBe(1);
      expect(claimLogs[0].actorId).toBe(dbItem.assigneeId);
      expect(claimLogs[0].oldValue).toBe(WorkItemStatus.OPEN);
      expect((claimLogs[0].metadata as Record<string, unknown>).previousStatus).toBe(WorkItemStatus.OPEN);
      expect((claimLogs[0].metadata as Record<string, unknown>).newStatus).toBe(WorkItemStatus.IN_PROGRESS);
    });

    it('accurately records previousStatus when claiming an unassigned item already in IN_PROGRESS status', async () => {
      // Create an unassigned item in IN_PROGRESS status
      const item = await prisma.workItem.create({
        data: {
          title: 'Unassigned In-Progress Triage Ticket',
          description: 'Item started by triage automation but unassigned.',
          status: WorkItemStatus.IN_PROGRESS,
          teamId: platformTeamId,
          creatorId: devMemberId,
          assigneeId: null,
          version: 1,
        },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/claim`)
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({ version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.workItem.assigneeId).toBe(devMemberId);
      expect(res.body.data.workItem.version).toBe(2);

      // Verify activity log accurately records previousStatus as IN_PROGRESS
      const claimLog = await prisma.activityLog.findFirstOrThrow({
        where: { workItemId: item.id, action: ActivityAction.CLAIMED },
      });
      expect(claimLog.oldValue).toBe(WorkItemStatus.IN_PROGRESS);
      expect((claimLog.metadata as Record<string, unknown>).previousStatus).toBe(WorkItemStatus.IN_PROGRESS);
      expect((claimLog.metadata as Record<string, unknown>).newStatus).toBe(WorkItemStatus.IN_PROGRESS);
    });

    it('returns 409 Conflict and creates no activity log when claiming with an outdated version', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Outdated Version Claim Test',
          description: 'Item is at version 2',
          status: WorkItemStatus.OPEN,
          teamId: platformTeamId,
          creatorId: devMemberId,
          assigneeId: null,
          version: 2,
        },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/claim`)
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({ version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('version mismatch');

      const dbItem = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(dbItem.version).toBe(2);
      expect(dbItem.assigneeId).toBeNull();

      const claimLogs = await prisma.activityLog.findMany({
        where: { workItemId: item.id, action: ActivityAction.CLAIMED },
      });
      expect(claimLogs.length).toBe(0);
    });

    it('returns 409 Conflict when attempting to claim an unassigned item in an invalid status (e.g. RESOLVED)', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Resolved Item Claim Test',
          description: 'Cannot claim a resolved item',
          status: WorkItemStatus.RESOLVED,
          teamId: platformTeamId,
          creatorId: devMemberId,
          assigneeId: null,
          version: 1,
        },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/claim`)
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({ version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('cannot be claimed in its current status');

      const claimLogs = await prisma.activityLog.findMany({
        where: { workItemId: item.id, action: ActivityAction.CLAIMED },
      });
      expect(claimLogs.length).toBe(0);
    });

    it('returns 409 Conflict when attempting to claim an already assigned item', async () => {
      // Find an item that is already assigned
      const assignedItem = await prisma.workItem.findFirstOrThrow({
        where: { teamId: platformTeamId, assigneeId: { not: null } },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${assignedItem.id}/claim`)
        .set('Authorization', `Bearer ${juniorMemberToken}`)
        .send();

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('already been claimed');
    });

    it('denies claiming with 403 Forbidden when user belongs to an unauthorized team (cross-team IDOR)', async () => {
      // Create an unassigned item in platform-ops
      const item = await prisma.workItem.create({
        data: {
          title: 'Unassigned item in platform-ops',
          description: 'Testing cross-team claim blocking',
          status: WorkItemStatus.OPEN,
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 1,
        },
      });

      // incidentLead belongs ONLY to incident-response, NOT platform-ops
      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/claim`)
        .set('Authorization', `Bearer ${incidentLeadToken}`)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('do not have access to work items in this team');
    });

    it('denies claiming with 403 Forbidden when user has VIEWER role in the team', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Unassigned item for viewer check',
          description: 'Viewers cannot claim items',
          status: WorkItemStatus.OPEN,
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 1,
        },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/claim`)
        .set('Authorization', `Bearer ${auditorViewerToken}`)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('Viewers cannot claim work items');
    });
  });

  describe('Optimistic Concurrency Control (Critical Behaviour B)', () => {
    it('succeeds and increments version when submitted version matches current database version', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'OCC Base Test Item',
          description: 'Testing single optimistic lock increment',
          teamId: platformTeamId,
          creatorId: devMemberId,
          assigneeId: devMemberId,
          version: 1,
        },
      });

      const res = await request(app)
        .patch(`/api/v1/work-items/${item.id}`)
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({
          version: 1,
          title: 'OCC Base Test Item - Version 2',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.workItem.version).toBe(2);
      expect(res.body.data.workItem.title).toBe('OCC Base Test Item - Version 2');

      const dbItem = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(dbItem.version).toBe(2);
    });

    it('rejects stale update with 409 Conflict when submitting an outdated version', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Stale Version Test',
          description: 'Currently at version 2',
          teamId: platformTeamId,
          creatorId: devMemberId,
          assigneeId: devMemberId,
          version: 2,
        },
      });

      // User submits stale version 1
      const res = await request(app)
        .patch(`/api/v1/work-items/${item.id}`)
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({
          version: 1,
          title: 'Stale update attempt',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('modified by another operation');
      expect(res.body.error.message).toContain('Expected version 1, but current version is 2');

      // Database record remains unchanged
      const dbItem = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(dbItem.version).toBe(2);
      expect(dbItem.title).toBe('Stale Version Test');
    });

    it('executes two simultaneous updates with the same version: exactly ONE succeeds (200) and ONE fails (409)', async () => {
      // Platform lead can update any ticket
      const item = await prisma.workItem.create({
        data: {
          title: 'Concurrent Race OCC Test Item',
          description: 'Testing race condition on OCC version check',
          teamId: platformTeamId,
          creatorId: devMemberId,
          assigneeId: devMemberId,
          version: 1,
        },
      });

      // Two overlapping requests with version 1
      const [res1, res2] = await Promise.all([
        request(app)
          .patch(`/api/v1/work-items/${item.id}`)
          .set('Authorization', `Bearer ${platformLeadToken}`)
          .send({
            version: 1,
            title: 'Lead Update A: Increased Priority',
            priority: WorkItemPriority.HIGH,
          }),
        request(app)
          .patch(`/api/v1/work-items/${item.id}`)
          .set('Authorization', `Bearer ${devMemberToken}`)
          .send({
            version: 1,
            title: 'Member Update B: Added Implementation Notes',
            description: 'Refactored internal loops to avoid memory leak.',
          }),
      ]);

      const statuses = [res1.status, res2.status].sort();

      // Concurrency guarantee: exactly one 200 and one 409
      expect(statuses).toEqual([200, 409]);

      const winnerRes = res1.status === 200 ? res1 : res2;
      const loserRes = res1.status === 409 ? res1 : res2;

      expect(winnerRes.body.success).toBe(true);
      expect(winnerRes.body.data.workItem.version).toBe(2);

      expect(loserRes.body.success).toBe(false);
      expect(loserRes.body.error.message).toContain('modified by another operation');

      // Exactly ONE activity log event must exist for this update
      const updateLogs = await prisma.activityLog.findMany({
        where: { workItemId: item.id, action: ActivityAction.UPDATED },
      });
      expect(updateLogs.length).toBe(1);
      expect(updateLogs[0].metadata).toMatchObject({
        previousVersion: 1,
        newVersion: 2,
      });
    });
  });
});
