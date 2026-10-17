import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/config/db';
import { generateToken } from '../src/utils/jwt';
import { ActivityAction, WorkItemPriority, WorkItemStatus, WorkItemType } from '@prisma/client';

describe('Activity Timeline & Comments API', () => {
  let platformTeamId: string;
  let incidentTeamId: string;

  let devMemberToken: string;
  let juniorMemberToken: string;
  let incidentLeadToken: string;
  let auditorViewerToken: string;

  let devMemberId: string;
  let juniorMemberId: string;

  beforeAll(async () => {
    const platformTeam = await prisma.team.findUniqueOrThrow({ where: { slug: 'platform-ops' } });
    const incidentTeam = await prisma.team.findUniqueOrThrow({ where: { slug: 'incident-response' } });

    platformTeamId = platformTeam.id;
    incidentTeamId = incidentTeam.id;

    const [devMember, juniorMember, incidentLead, auditorViewer] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: 'member.dev@opsflow.io' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'member.junior@opsflow.io' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'lead.incident@opsflow.io' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'viewer.audit@opsflow.io' } }),
    ]);

    devMemberId = devMember.id;
    juniorMemberId = juniorMember.id;

    devMemberToken = generateToken({ userId: devMember.id, email: devMember.email });
    juniorMemberToken = generateToken({ userId: juniorMember.id, email: juniorMember.email });
    incidentLeadToken = generateToken({ userId: incidentLead.id, email: incidentLead.email });
    auditorViewerToken = generateToken({ userId: auditorViewer.id, email: auditorViewer.email });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Activity Timeline (GET /api/v1/work-items/:id/activity)', () => {
    it('retrieves paginated activity history with deterministic ordering (newest first)', async () => {
      // Create a ticket and generate multiple activity logs
      const item = await prisma.workItem.create({
        data: {
          title: 'Activity Timeline Verification Ticket',
          description: 'Testing activity ordering and structure',
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 1,
        },
      });

      // Add three explicit activity logs
      await prisma.activityLog.createMany({
        data: [
          {
            workItemId: item.id,
            actorId: devMemberId,
            action: ActivityAction.CREATED,
            createdAt: new Date('2026-10-17T10:00:00Z'),
          },
          {
            workItemId: item.id,
            actorId: devMemberId,
            action: ActivityAction.STATUS_CHANGED,
            oldValue: WorkItemStatus.OPEN,
            newValue: WorkItemStatus.IN_PROGRESS,
            createdAt: new Date('2026-10-17T10:05:00Z'),
          },
          {
            workItemId: item.id,
            actorId: devMemberId,
            action: ActivityAction.COMMENTED,
            createdAt: new Date('2026-10-17T10:10:00Z'),
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/work-items/${item.id}/activity?page=1&limit=2`)
        .set('Authorization', `Bearer ${juniorMemberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.pagination).toMatchObject({
        page: 1,
        limit: 2,
        totalItems: 3,
        totalPages: 2,
      });

      // Verify newest first: the latest action (COMMENTED) must be first
      expect(res.body.data[0].action).toBe(ActivityAction.COMMENTED);
      expect(res.body.data[0].actor).toMatchObject({
        id: devMemberId,
        email: 'member.dev@opsflow.io',
      });
    });

    it('denies activity history access with 403 when requesting an item from another team', async () => {
      const item = await prisma.workItem.findFirstOrThrow({
        where: { teamId: incidentTeamId },
      });

      // juniorMember has NO access to incident-response
      const res = await request(app)
        .get(`/api/v1/work-items/${item.id}/activity`)
        .set('Authorization', `Bearer ${juniorMemberToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('do not have access');
    });
  });

  describe('2. Comments (POST & GET /api/v1/work-items/:id/comments)', () => {
    it('creates a comment attributed to the caller and records a COMMENTED activity event', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Ticket for Comment Testing',
          description: 'Testing comment addition and attribution',
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 1,
        },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/comments`)
        .set('Authorization', `Bearer ${juniorMemberToken}`)
        .send({
          content: 'I have started validating the staging replica logs.',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.comment.content).toBe('I have started validating the staging replica logs.');
      expect(res.body.data.comment.author.id).toBe(juniorMemberId);

      // Verify activity log event recorded
      const activity = await prisma.activityLog.findFirst({
        where: { workItemId: item.id, action: ActivityAction.COMMENTED },
      });
      expect(activity).not.toBeNull();
      expect(activity?.actorId).toBe(juniorMemberId);
    });

    it('allows Viewer to read comments and add a comment on accessible team item', async () => {
      const item = await prisma.workItem.findFirstOrThrow({
        where: { teamId: platformTeamId },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/comments`)
        .set('Authorization', `Bearer ${auditorViewerToken}`)
        .send({
          content: 'Compliance note: verify retention policies for audit logs.',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('rejects empty comments with 400 Bad Request', async () => {
      const item = await prisma.workItem.findFirstOrThrow({
        where: { teamId: platformTeamId },
      });

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/comments`)
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({
          content: '   ',
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.error)).toContain('cannot be empty');
    });

    it('rejects comments exceeding 2000 characters with 400 Bad Request', async () => {
      const item = await prisma.workItem.findFirstOrThrow({
        where: { teamId: platformTeamId },
      });

      const hugeComment = 'a'.repeat(2001);

      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/comments`)
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({
          content: hugeComment,
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.error)).toContain('exceeds maximum');
    });

    it('denies comment creation with 403 on work item belonging to an inaccessible team', async () => {
      const item = await prisma.workItem.findFirstOrThrow({
        where: { teamId: platformTeamId },
      });

      // incidentLead is NOT in platform-ops
      const res = await request(app)
        .post(`/api/v1/work-items/${item.id}/comments`)
        .set('Authorization', `Bearer ${incidentLeadToken}`)
        .send({
          content: 'Unauthorized comment attempt across teams',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('do not have access');
    });

    it('retrieves chronological comments for a work item', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Chronological Comment Retrieval Test',
          description: 'Testing comment ordering',
          teamId: platformTeamId,
          creatorId: devMemberId,
          version: 1,
        },
      });

      await prisma.comment.createMany({
        data: [
          {
            workItemId: item.id,
            authorId: devMemberId,
            content: 'Comment 1',
            createdAt: new Date('2026-10-17T11:00:00Z'),
          },
          {
            workItemId: item.id,
            authorId: juniorMemberId,
            content: 'Comment 2',
            createdAt: new Date('2026-10-17T11:05:00Z'),
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/work-items/${item.id}/comments`)
        .set('Authorization', `Bearer ${devMemberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.comments.length).toBe(2);
      expect(res.body.data.comments[0].content).toBe('Comment 1');
      expect(res.body.data.comments[1].content).toBe('Comment 2');
    });
  });
});
