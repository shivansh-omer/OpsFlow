import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Role } from '@prisma/client';
import { app } from '../src/app';
import { prisma } from '../src/config/db';
import { generateToken } from '../src/utils/jwt';
import { authenticate } from '../src/middleware/authenticate';
import { requireTeamMembership, requireTeamRole, hasMinimumRole } from '../src/middleware/teamAuth';

describe('Team-Scoped RBAC & Isolation API', () => {
  let platformTeamId: string;
  let incidentTeamId: string;

  let adminToken: string;
  let platformLeadToken: string;
  let incidentLeadToken: string;
  let devMemberToken: string;
  let juniorMemberToken: string;
  let auditorViewerToken: string;

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

  describe('GET /api/v1/teams (Scoped to authenticated user)', () => {
    it('returns both teams for admin who has membership in both', async () => {
      const res = await request(app)
        .get('/api/v1/teams')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.teams.length).toBe(2);

      const slugs = res.body.data.teams.map((t: { slug: string }) => t.slug);
      expect(slugs).toContain('platform-ops');
      expect(slugs).toContain('incident-response');
    });

    it('returns ONLY incident-response team for incident lead who belongs to no other team', async () => {
      const res = await request(app)
        .get('/api/v1/teams')
        .set('Authorization', `Bearer ${incidentLeadToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.teams.length).toBe(1);
      expect(res.body.data.teams[0].slug).toBe('incident-response');
      expect(res.body.data.teams[0].myRole).toBe(Role.LEAD);
    });

    it('returns ONLY platform-ops team for junior member who belongs only to platform-ops', async () => {
      const res = await request(app)
        .get('/api/v1/teams')
        .set('Authorization', `Bearer ${juniorMemberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.teams.length).toBe(1);
      expect(res.body.data.teams[0].slug).toBe('platform-ops');
      expect(res.body.data.teams[0].myRole).toBe(Role.MEMBER);
    });
  });

  describe('GET /api/v1/teams/:teamId/members (Team boundary enforcement)', () => {
    it('allows a member to view the member list of their own team', async () => {
      const res = await request(app)
        .get(`/api/v1/teams/${platformTeamId}/members`)
        .set('Authorization', `Bearer ${juniorMemberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.members)).toBe(true);
      expect(res.body.data.members.length).toBeGreaterThanOrEqual(1);

      // Verify no password hash is exposed in member user objects
      res.body.data.members.forEach((m: { user: { passwordHash?: string } }) => {
        expect(m.user.passwordHash).toBeUndefined();
      });
    });

    it('denies access with 403 Forbidden when accessing a team the user is not a member of (Cross-Team IDOR Prevention)', async () => {
      // juniorMember is ONLY in platformTeamId, NOT in incidentTeamId
      const res = await request(app)
        .get(`/api/v1/teams/${incidentTeamId}/members`)
        .set('Authorization', `Bearer ${juniorMemberToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Access denied');
    });
  });

  describe('Live Database Role & Membership Verification (Revocation Test)', () => {
    it('immediately denies access with 403 when membership is deleted from DB even if JWT token is still valid', async () => {
      // 1. Create a transient user and team membership
      const transientUser = await prisma.user.create({
        data: {
          email: 'revoked.user@opsflow.io',
          name: 'Revoked User',
          passwordHash: 'dummy',
        },
      });

      const membership = await prisma.teamMember.create({
        data: {
          teamId: platformTeamId,
          userId: transientUser.id,
          role: Role.MEMBER,
        },
      });

      const token = generateToken({
        userId: transientUser.id,
        email: transientUser.email,
      });

      // 2. Verify initial access succeeds (200)
      const resBefore = await request(app)
        .get(`/api/v1/teams/${platformTeamId}/members`)
        .set('Authorization', `Bearer ${token}`);

      expect(resBefore.status).toBe(200);

      // 3. Revoke membership in database
      await prisma.teamMember.delete({
        where: { id: membership.id },
      });

      // 4. Attempt to access again with the EXACT same token
      const resAfter = await request(app)
        .get(`/api/v1/teams/${platformTeamId}/members`)
        .set('Authorization', `Bearer ${token}`);

      // Must be rejected with 403 because role/membership is checked against live DB
      expect(resAfter.status).toBe(403);
      expect(resAfter.body.error.message).toContain('Access denied: You are not a member of this team or your membership has been revoked');

      // Cleanup transient user
      await prisma.user.delete({ where: { id: transientUser.id } });
    });
  });

  describe('Role-Permission Enforcement (Viewer, Member, Lead, Admin)', () => {
    let testApp: ReturnType<typeof import('express')>;

    beforeAll(async () => {
      const express = (await import('express')).default;
      const { errorHandler } = await import('../src/middleware/errorHandler');

      testApp = express();
      testApp.use(express.json());

      testApp.get(
        '/api/v1/test-team/:teamId/lead-action',
        authenticate,
        requireTeamMembership(),
        requireTeamRole([Role.LEAD, Role.ADMIN]),
        (_req, res) => {
          res.status(200).json({ success: true, message: 'Lead action executed' });
        }
      );

      testApp.use(errorHandler);
    });

    it('rejects Viewer with 403 when attempting Lead/Admin action', async () => {
      const res = await request(testApp)
        .get(`/api/v1/test-team/${platformTeamId}/lead-action`)
        .set('Authorization', `Bearer ${auditorViewerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('VIEWER');
    });

    it('rejects Member with 403 when attempting Lead/Admin action', async () => {
      const res = await request(testApp)
        .get(`/api/v1/test-team/${platformTeamId}/lead-action`)
        .set('Authorization', `Bearer ${devMemberToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('MEMBER');
    });

    it('permits Lead with 200 when executing Lead/Admin action', async () => {
      const res = await request(testApp)
        .get(`/api/v1/test-team/${platformTeamId}/lead-action`)
        .set('Authorization', `Bearer ${platformLeadToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Lead action executed');
    });

    it('permits Admin with 200 when executing Lead/Admin action', async () => {
      const res = await request(testApp)
        .get(`/api/v1/test-team/${platformTeamId}/lead-action`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Lead action executed');
    });

    it('verifies role hierarchy ordering', () => {
      expect(hasMinimumRole(Role.ADMIN, Role.LEAD)).toBe(true);
      expect(hasMinimumRole(Role.LEAD, Role.MEMBER)).toBe(true);
      expect(hasMinimumRole(Role.MEMBER, Role.VIEWER)).toBe(true);
      expect(hasMinimumRole(Role.VIEWER, Role.MEMBER)).toBe(false);
      expect(hasMinimumRole(Role.MEMBER, Role.LEAD)).toBe(false);
    });
  });
});
