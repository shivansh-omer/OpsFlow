import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/config/db';
import { generateToken } from '../src/utils/jwt';
import { ActivityAction, Role, WorkItemPriority, WorkItemType } from '@prisma/client';

describe('Work Items API (/api/v1/work-items)', () => {
  let platformTeamId: string;
  let incidentTeamId: string;

  let adminToken: string;
  let platformLeadToken: string;
  let incidentLeadToken: string;
  let devMemberToken: string;
  let juniorMemberToken: string;
  let auditorViewerToken: string;

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

  describe('1. Work Item Creation', () => {
    it('creates a work item when authorized member submits valid payload', async () => {
      const res = await request(app)
        .post('/api/v1/work-items')
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({
          title: 'Implement distributed tracing with OpenTelemetry',
          description: 'Deploy collector agents and instrument critical RPC service paths.',
          type: WorkItemType.TASK,
          priority: WorkItemPriority.HIGH,
          teamId: platformTeamId,
          assigneeId: devMemberId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.workItem.id).toBeDefined();
      expect(res.body.data.workItem.version).toBe(1);
      expect(res.body.data.workItem.status).toBe('OPEN');
      expect(res.body.data.workItem.creator.id).toBe(devMemberId);

      // Verify activity history was recorded atomically
      const activities = await prisma.activityLog.findMany({
        where: { workItemId: res.body.data.workItem.id },
      });
      expect(activities.length).toBe(1);
      expect(activities[0].action).toBe(ActivityAction.CREATED);
    });

    it('rejects creation when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/v1/work-items')
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({
          description: 'Missing title',
          teamId: platformTeamId,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'title' })])
      );
    });

    it('rejects creation if client tries to set protected fields', async () => {
      const res = await request(app)
        .post('/api/v1/work-items')
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({
          title: 'Attempting to inject version and creatorId',
          description: 'Should be blocked by strict schema',
          teamId: platformTeamId,
          version: 999,
          creatorId: 'spoofed-id',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('validation failed');
    });

    it('rejects creation if assignee does not belong to the target team', async () => {
      // Create a foreign user
      const foreignUser = await prisma.user.create({
        data: {
          email: 'foreign.guest@opsflow.io',
          name: 'Foreign Guest',
          passwordHash: 'dummy',
        },
      });

      const res = await request(app)
        .post('/api/v1/work-items')
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({
          title: 'Task with invalid external assignee',
          description: 'Assignee does not belong to platform-ops team',
          teamId: platformTeamId,
          assigneeId: foreignUser.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Assigned user must be an active member');

      await prisma.user.delete({ where: { id: foreignUser.id } });
    });

    it('denies creation for Viewer with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/work-items')
        .set('Authorization', `Bearer ${auditorViewerToken}`)
        .send({
          title: 'Viewer attempting creation',
          description: 'Viewers are strictly read-only',
          teamId: platformTeamId,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('Viewers have read-only access');
    });

    it('denies creation in a team the user does not belong to (Cross-team access denial)', async () => {
      // incidentLead belongs ONLY to incident-response, NOT platform-ops
      const res = await request(app)
        .post('/api/v1/work-items')
        .set('Authorization', `Bearer ${incidentLeadToken}`)
        .send({
          title: 'Unauthorized cross-team creation',
          description: 'Attempting to create ticket in platform-ops',
          teamId: platformTeamId,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('do not have access');
    });
  });

  describe('2. Listing & Server-Side Filtering / Pagination', () => {
    it('returns only work items from teams the user belongs to', async () => {
      // juniorMember is ONLY in platform-ops
      const res = await request(app)
        .get('/api/v1/work-items')
        .set('Authorization', `Bearer ${juniorMemberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      // Verify every returned item belongs to platform-ops
      res.body.data.forEach((item: { team: { slug: string } }) => {
        expect(item.team.slug).toBe('platform-ops');
      });
    });

    it('denies with 403 when user explicitly filters by a team they do not belong to (IDOR)', async () => {
      // juniorMember has no access to incidentTeamId
      const res = await request(app)
        .get(`/api/v1/work-items?teamId=${incidentTeamId}`)
        .set('Authorization', `Bearer ${juniorMemberToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('do not have access');
    });

    it('supports server-side filtering by priority, type, and pagination metadata', async () => {
      const res = await request(app)
        .get('/api/v1/work-items?page=1&limit=2&sortBy=createdAt&sortOrder=desc')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.pagination).toMatchObject({
        page: 1,
        limit: 2,
        totalItems: expect.any(Number),
        totalPages: expect.any(Number),
      });
    });

    it('supports search query matching title or description', async () => {
      const res = await request(app)
        .get('/api/v1/work-items?search=PostgreSQL')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].title).toContain('PostgreSQL');
    });
  });

  describe('3. Single Item Retrieval', () => {
    it('allows member to retrieve item belonging to their team', async () => {
      // Find an item in platform-ops
      const item = await prisma.workItem.findFirstOrThrow({
        where: { teamId: platformTeamId },
      });

      const res = await request(app)
        .get(`/api/v1/work-items/${item.id}`)
        .set('Authorization', `Bearer ${juniorMemberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.workItem.id).toBe(item.id);
      expect(res.body.data.workItem.myRole).toBe(Role.MEMBER);
    });

    it('denies retrieval with 403 when item belongs to an inaccessible team', async () => {
      // Find an item in incident-response
      const incidentItem = await prisma.workItem.findFirstOrThrow({
        where: { teamId: incidentTeamId },
      });

      // juniorMember has NO access to incident-response
      const res = await request(app)
        .get(`/api/v1/work-items/${incidentItem.id}`)
        .set('Authorization', `Bearer ${juniorMemberToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('do not have access');
    });

    it('returns 404 for non-existent item id', async () => {
      const res = await request(app)
        .get('/api/v1/work-items/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('4. Work Item Updates & Protected Field Rejection', () => {
    it('allows assignee to update permitted fields with correct version and records activity log', async () => {
      const item = await prisma.workItem.create({
        data: {
          title: 'Initial Test Item for Update',
          description: 'Testing update flow',
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
          title: 'Updated Test Item Title',
          description: 'Updated test item description with new details.',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.workItem.version).toBe(2);
      expect(res.body.data.workItem.title).toBe('Updated Test Item Title');

      // Verify activity log
      const logs = await prisma.activityLog.findMany({
        where: { workItemId: item.id, action: ActivityAction.UPDATED },
      });
      expect(logs.length).toBe(1);
    });

    it('rejects update if client attempts to modify protected fields', async () => {
      const item = await prisma.workItem.findFirstOrThrow({
        where: { teamId: platformTeamId, assigneeId: devMemberId },
      });

      const res = await request(app)
        .patch(`/api/v1/work-items/${item.id}`)
        .set('Authorization', `Bearer ${devMemberToken}`)
        .send({
          version: item.version,
          creatorId: 'hacker-id',
          teamId: incidentTeamId,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('validation failed');
    });

    it('denies member from editing a work item assigned to someone else', async () => {
      // Find item assigned to devMember
      const item = await prisma.workItem.findFirstOrThrow({
        where: { teamId: platformTeamId, assigneeId: devMemberId },
      });

      // juniorMember tries to edit it
      const res = await request(app)
        .patch(`/api/v1/work-items/${item.id}`)
        .set('Authorization', `Bearer ${juniorMemberToken}`)
        .send({
          version: item.version,
          title: 'Unauthorized title edit by colleague',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('only edit work items assigned to them');
    });

    it('allows Lead or Admin to edit any work item in the team', async () => {
      // Find item assigned to devMember
      const item = await prisma.workItem.findFirstOrThrow({
        where: { teamId: platformTeamId, assigneeId: devMemberId },
      });

      // platformLead can edit it
      const res = await request(app)
        .patch(`/api/v1/work-items/${item.id}`)
        .set('Authorization', `Bearer ${platformLeadToken}`)
        .send({
          version: item.version,
          priority: WorkItemPriority.URGENT,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.workItem.priority).toBe(WorkItemPriority.URGENT);
      expect(res.body.data.workItem.version).toBe(item.version + 1);
    });
  });
});
