import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/config/db';
import { generateToken } from '../src/utils/jwt';
import { WorkItemPriority, WorkItemStatus, WorkItemType } from '@prisma/client';

describe('Dashboard Operations API (/api/v1/dashboard)', () => {
  let platformTeamId: string;
  let incidentTeamId: string;

  let adminToken: string;
  let platformLeadToken: string;
  let devMemberToken: string;
  let juniorMemberToken: string;

  let devMemberId: string;

  beforeAll(async () => {
    const platformTeam = await prisma.team.findUniqueOrThrow({ where: { slug: 'platform-ops' } });
    const incidentTeam = await prisma.team.findUniqueOrThrow({ where: { slug: 'incident-response' } });

    platformTeamId = platformTeam.id;
    incidentTeamId = incidentTeam.id;

    const [admin, platformLead, devMember, juniorMember] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: 'admin@opsflow.io' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'lead.platform@opsflow.io' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'member.dev@opsflow.io' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'member.junior@opsflow.io' } }),
    ]);

    devMemberId = devMember.id;

    adminToken = generateToken({ userId: admin.id, email: admin.email });
    platformLeadToken = generateToken({ userId: platformLead.id, email: platformLead.email });
    devMemberToken = generateToken({ userId: devMember.id, email: devMember.email });
    juniorMemberToken = generateToken({ userId: juniorMember.id, email: juniorMember.email });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('retrieves comprehensive dashboard metrics and queues for authenticated user', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${platformLeadToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { summary, assignedToMe, unassignedUrgent, awaitingMyApproval, overdue, recentActivity } =
      res.body.data;

    // Summary assertions
    expect(summary).toBeDefined();
    expect(typeof summary.totalActive).toBe('number');
    expect(summary.byStatus).toBeDefined();
    expect(summary.byPriority).toBeDefined();

    // Queues assertions
    expect(Array.isArray(assignedToMe.items)).toBe(true);
    expect(typeof assignedToMe.count).toBe('number');

    expect(Array.isArray(unassignedUrgent.items)).toBe(true);
    expect(typeof unassignedUrgent.count).toBe('number');

    expect(Array.isArray(awaitingMyApproval.items)).toBe(true);
    expect(typeof awaitingMyApproval.count).toBe('number');

    expect(Array.isArray(overdue.items)).toBe(true);
    expect(typeof overdue.count).toBe('number');

    expect(Array.isArray(recentActivity)).toBe(true);
  });

  it('correctly includes overdue items (due date in past and status not resolved/closed)', async () => {
    // Create an explicit overdue item in platformTeam
    const pastDueDate = new Date(Date.now() - 48 * 3600 * 1000); // 2 days ago
    const overdueItem = await prisma.workItem.create({
      data: {
        title: 'Overdue Certificate Expiry Warning',
        description: 'TLS cert renewal overdue.',
        status: WorkItemStatus.IN_PROGRESS,
        priority: WorkItemPriority.HIGH,
        teamId: platformTeamId,
        creatorId: devMemberId,
        assigneeId: devMemberId,
        dueDate: pastDueDate,
        version: 1,
      },
    });

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${devMemberToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.overdue.count).toBeGreaterThanOrEqual(1);

    const ids = res.body.data.overdue.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(overdueItem.id);
  });

  it('limits Awaiting My Approval to users holding Lead or Admin roles in that team', async () => {
    // PlatformLead is LEAD in platform-ops -> sees approval queue
    const leadRes = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${platformLeadToken}`);

    expect(leadRes.status).toBe(200);
    expect(leadRes.body.data.awaitingMyApproval.count).toBeGreaterThanOrEqual(1);

    // JuniorMember is MEMBER only in platform-ops -> sees 0 in awaiting approval queue
    const memberRes = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${juniorMemberToken}`);

    expect(memberRes.status).toBe(200);
    expect(memberRes.body.data.awaitingMyApproval.count).toBe(0);
    expect(memberRes.body.data.awaitingMyApproval.items.length).toBe(0);
  });

  it('supports explicit team-scoping via ?teamId query parameter', async () => {
    const res = await request(app)
      .get(`/api/v1/dashboard?teamId=${platformTeamId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify recent activity only contains events from platformTeam
    res.body.data.recentActivity.forEach((act: { workItem: { team: { id: string } } }) => {
      expect(act.workItem.team.id).toBe(platformTeamId);
    });
  });

  it('denies dashboard query with 403 when user queries a team they do NOT belong to (IDOR protection)', async () => {
    // juniorMember belongs to platform-ops, NOT incident-response
    const res = await request(app)
      .get(`/api/v1/dashboard?teamId=${incidentTeamId}`)
      .set('Authorization', `Bearer ${juniorMemberToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('do not have access to view dashboard metrics');
  });
});
