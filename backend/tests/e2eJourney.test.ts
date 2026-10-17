import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/app';
import { prisma } from '../src/config/db';
import { WorkflowAction } from '../src/services/workflow.service';
import { WorkItemPriority, WorkItemStatus, WorkItemType } from '@prisma/client';

describe('End-to-End Real World Operations Journey (Phase 6 Verification)', () => {
  let platformTeamId: string;
  let incidentTeamId: string;

  let devMemberToken: string;
  let devMemberId: string;
  let platformLeadToken: string;
  let platformLeadId: string;
  let incidentLeadToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    const platformTeam = await prisma.team.findUniqueOrThrow({ where: { slug: 'platform-ops' } });
    const incidentTeam = await prisma.team.findUniqueOrThrow({ where: { slug: 'incident-response' } });
    platformTeamId = platformTeam.id;
    incidentTeamId = incidentTeam.id;

    // 1. Authenticate via demo-login endpoint (Step 1)
    const [loginDev, loginLead, loginIncidentLead, loginViewer] = await Promise.all([
      request(app).post('/api/v1/auth/demo-login').send({ persona: 'member-dev' }),
      request(app).post('/api/v1/auth/demo-login').send({ persona: 'lead-platform' }),
      request(app).post('/api/v1/auth/demo-login').send({ persona: 'lead-incident' }),
      request(app).post('/api/v1/auth/demo-login').send({ persona: 'viewer' }),
    ]);

    expect(loginDev.status).toBe(200);
    expect(loginLead.status).toBe(200);
    expect(loginIncidentLead.status).toBe(200);
    expect(loginViewer.status).toBe(200);

    devMemberToken = loginDev.body.data.token;
    devMemberId = loginDev.body.data.user.id;
    platformLeadToken = loginLead.body.data.token;
    platformLeadId = loginLead.body.data.user.id;
    incidentLeadToken = loginIncidentLead.body.data.token;
    viewerToken = loginViewer.body.data.token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('verifies the complete 12-step operational journey', async () => {
    // 2. Load the dashboard and confirm its metrics come from the backend
    const dashboardRes = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${devMemberToken}`);

    expect(dashboardRes.status).toBe(200);
    expect(dashboardRes.body.success).toBe(true);
    expect(dashboardRes.body.data.summary).toBeDefined();
    expect(dashboardRes.body.data.summary.totalActive).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(dashboardRes.body.data.recentActivity)).toBe(true);

    // 3. Create a work item and confirm it persists in PostgreSQL
    const idempotencyKey = crypto.randomUUID();
    const createRes = await request(app)
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${devMemberToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        title: `Kubernetes node memory leak mitigation ${crypto.randomUUID()}`,
        description: 'Restart containerd daemon on worker pool node-04',
        type: WorkItemType.INCIDENT,
        priority: WorkItemPriority.HIGH,
        teamId: platformTeamId,
        assigneeId: null, // Start unassigned
      });

    expect(createRes.status).toBe(201);
    const workItemId = createRes.body.data.workItem.id;
    expect(createRes.body.data.workItem.version).toBe(1);
    expect(createRes.body.data.workItem.status).toBe(WorkItemStatus.OPEN);

    // Verify in PostgreSQL
    const dbItem1 = await prisma.workItem.findUniqueOrThrow({ where: { id: workItemId } });
    expect(dbItem1.assigneeId).toBeNull();

    // 4. Claim an unassigned item and verify its assignment and activity history
    const claimRes = await request(app)
      .post(`/api/v1/work-items/${workItemId}/claim`)
      .set('Authorization', `Bearer ${devMemberToken}`)
      .send({ version: 1 });

    expect(claimRes.status).toBe(200);
    expect(claimRes.body.data.workItem.assignee.id).toBe(devMemberId);
    expect(claimRes.body.data.workItem.status).toBe(WorkItemStatus.IN_PROGRESS);
    expect(claimRes.body.data.workItem.version).toBe(2);

    // Check activity log recorded CLAIMED
    const claimLogs = await prisma.activityLog.findMany({
      where: { workItemId, action: 'CLAIMED' },
    });
    expect(claimLogs.length).toBe(1);
    expect(claimLogs[0].actorId).toBe(devMemberId);

    // 5. Update an item and verify its version increments
    const updateRes = await request(app)
      .patch(`/api/v1/work-items/${workItemId}`)
      .set('Authorization', `Bearer ${devMemberToken}`)
      .send({
        version: 2,
        description: 'Restart containerd daemon on worker pool node-04. Node cordoned.',
        priority: WorkItemPriority.URGENT,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.workItem.version).toBe(3);
    expect(updateRes.body.data.workItem.priority).toBe(WorkItemPriority.URGENT);

    // 6. Submit it for approval
    const submitRes = await request(app)
      .post(`/api/v1/work-items/${workItemId}/transitions`)
      .set('Authorization', `Bearer ${devMemberToken}`)
      .send({
        action: WorkflowAction.SUBMIT_FOR_APPROVAL,
        version: 3,
        comment: 'Remediation completed. Ready for lead signoff.',
      });

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.data.workItem.status).toBe(WorkItemStatus.AWAITING_APPROVAL);
    expect(submitRes.body.data.workItem.version).toBe(4);

    // Verify self-approval is blocked if submitter tries to approve
    const selfApproveRes = await request(app)
      .post(`/api/v1/work-items/${workItemId}/transitions`)
      .set('Authorization', `Bearer ${devMemberToken}`)
      .send({
        action: WorkflowAction.APPROVE,
        version: 4,
      });
    expect(selfApproveRes.status).toBe(403); // Member cannot approve, and separation of duties

    // 7. Log in as a different authorized Lead and approve it
    const approveRes = await request(app)
      .post(`/api/v1/work-items/${workItemId}/transitions`)
      .set('Authorization', `Bearer ${platformLeadToken}`)
      .send({
        action: WorkflowAction.APPROVE,
        version: 4,
        comment: 'Verified metrics returned to normal baseline.',
      });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.workItem.status).toBe(WorkItemStatus.RESOLVED);
    expect(approveRes.body.data.workItem.version).toBe(5);

    // 8. Close the resolved item
    const closeRes = await request(app)
      .post(`/api/v1/work-items/${workItemId}/transitions`)
      .set('Authorization', `Bearer ${platformLeadToken}`)
      .send({
        action: WorkflowAction.CLOSE,
        version: 5,
      });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.workItem.status).toBe(WorkItemStatus.CLOSED);
    expect(closeRes.body.data.workItem.version).toBe(6);

    // 9. Verify the activity timeline and comments
    // Add comment
    const commentRes = await request(app)
      .post(`/api/v1/work-items/${workItemId}/comments`)
      .set('Authorization', `Bearer ${devMemberToken}`)
      .send({ content: 'Post-incident review document linked in Jira ticket.' });
    expect(commentRes.status).toBe(201);

    // Fetch timeline
    const activityRes = await request(app)
      .get(`/api/v1/work-items/${workItemId}/activity`)
      .set('Authorization', `Bearer ${devMemberToken}`);

    expect(activityRes.status).toBe(200);
    expect(activityRes.body.data.length).toBeGreaterThanOrEqual(4);

    // Fetch comments
    const commentsListRes = await request(app)
      .get(`/api/v1/work-items/${workItemId}/comments`)
      .set('Authorization', `Bearer ${devMemberToken}`);

    expect(commentsListRes.status).toBe(200);
    expect(commentsListRes.body.data.comments.length).toBeGreaterThanOrEqual(1);

    // 10. Attempt a stale edit and confirm a visible 409 conflict
    const staleEditRes = await request(app)
      .patch(`/api/v1/work-items/${workItemId}`)
      .set('Authorization', `Bearer ${platformLeadToken}`)
      .send({
        version: 1, // Stale version (current is 6)
        title: 'Conflict overwrite attempt',
      });

    expect(staleEditRes.status).toBe(409);
    expect(staleEditRes.body.error.message).toContain('Conflict');

    // 11. Verify a Viewer cannot perform restricted actions
    const viewerCreateRes = await request(app)
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        title: 'Viewer unauthorized create',
        description: 'Should fail',
        teamId: platformTeamId,
      });
    expect(viewerCreateRes.status).toBe(403);

    const viewerClaimRes = await request(app)
      .post(`/api/v1/work-items/${workItemId}/claim`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ version: 6 });
    expect(viewerClaimRes.status).toBe(403);

    // 12. Verify a user cannot access an unauthorized team's item
    // Create an item in incident-response
    const incidentItem = await prisma.workItem.create({
      data: {
        title: 'Confidential security triage',
        description: 'Incident response only',
        teamId: incidentTeamId,
        creatorId: platformLeadId,
        version: 1,
      },
    });

    // devMember belongs ONLY to platform-ops (or let's test a user who is not in incidentTeamId)
    // juniorMember is ONLY in platform-ops!
    const juniorLogin = await request(app)
      .post('/api/v1/auth/demo-login')
      .send({ persona: 'member-junior' });
    const juniorToken = juniorLogin.body.data.token;

    const idorRes = await request(app)
      .get(`/api/v1/work-items/${incidentItem.id}`)
      .set('Authorization', `Bearer ${juniorToken}`);

    expect(idorRes.status).toBe(403);
    expect(idorRes.body.error.message).toContain('do not have access');

    // Clean up transient incident item
    await prisma.activityLog.deleteMany({ where: { workItemId: incidentItem.id } });
    await prisma.workItem.delete({ where: { id: incidentItem.id } });
  });
});
