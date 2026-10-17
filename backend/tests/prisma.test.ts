import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Role } from '@prisma/client';

describe('Phase 1 Database & Prisma Sanity Tests', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects to PostgreSQL and verifies seeded users', async () => {
    const users = await prisma.user.findMany();
    expect(users.length).toBeGreaterThanOrEqual(6);

    const admin = await prisma.user.findUnique({
      where: { email: 'admin@opsflow.io' },
    });
    expect(admin).not.toBeNull();
    expect(admin?.name).toContain('Admin');
  });

  it('verifies team roles and cross-role memberships', async () => {
    const platformLead = await prisma.user.findUnique({
      where: { email: 'lead.platform@opsflow.io' },
      include: { memberships: { include: { team: true } } },
    });

    expect(platformLead).not.toBeNull();
    expect(platformLead?.memberships.length).toBe(2);

    const platformMembership = platformLead?.memberships.find(
      (m) => m.team.slug === 'platform-ops'
    );
    const incidentMembership = platformLead?.memberships.find(
      (m) => m.team.slug === 'incident-response'
    );

    expect(platformMembership?.role).toBe(Role.LEAD);
    expect(incidentMembership?.role).toBe(Role.VIEWER);
  });

  it('verifies seeded work items and activity log association', async () => {
    const urgentItems = await prisma.workItem.findMany({
      where: { priority: 'URGENT' },
      include: { activities: true },
    });

    expect(urgentItems.length).toBeGreaterThanOrEqual(1);
    expect(urgentItems[0].status).toBe('OPEN');
    expect(urgentItems[0].activities.length).toBeGreaterThanOrEqual(1);
  });
});
