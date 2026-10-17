import { PrismaClient, Role, WorkItemPriority, WorkItemStatus, WorkItemType, ActivityAction } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting OpsFlow database seeding...');

  // Clean existing data in reverse order of foreign key dependencies
  await prisma.activityLog.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.workItem.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('password123', 10);

  // 1. Seed Users (Demo Personas)
  console.log('👤 Seeding demo users...');
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@opsflow.io',
      name: 'Alex Morgan (Admin)',
      passwordHash,
    },
  });

  const platformLead = await prisma.user.create({
    data: {
      email: 'lead.platform@opsflow.io',
      name: 'Elena Rostova (Platform Lead)',
      passwordHash,
    },
  });

  const incidentLead = await prisma.user.create({
    data: {
      email: 'lead.incident@opsflow.io',
      name: 'Marcus Vance (Incident Lead)',
      passwordHash,
    },
  });

  const devMember = await prisma.user.create({
    data: {
      email: 'member.dev@opsflow.io',
      name: 'Sarah Chen (Senior SRE)',
      passwordHash,
    },
  });

  const juniorMember = await prisma.user.create({
    data: {
      email: 'member.junior@opsflow.io',
      name: 'David Kim (Ops Associate)',
      passwordHash,
    },
  });

  const auditorViewer = await prisma.user.create({
    data: {
      email: 'viewer.audit@opsflow.io',
      name: 'Rachel Green (Compliance Auditor)',
      passwordHash,
    },
  });

  // 2. Seed Teams
  console.log('🏢 Seeding teams...');
  const platformTeam = await prisma.team.create({
    data: {
      name: 'Platform Operations',
      slug: 'platform-ops',
      description: 'Core infrastructure, orchestration, and continuous delivery systems.',
    },
  });

  const incidentTeam = await prisma.team.create({
    data: {
      name: 'Incident Response',
      slug: 'incident-response',
      description: 'Urgent reliability incidents, production hotfixes, and system triage.',
    },
  });

  // 3. Seed Team Memberships (Team-Specific Roles)
  console.log('🛡️ Assigning team roles...');
  await prisma.teamMember.createMany({
    data: [
      // Platform Operations team memberships
      { teamId: platformTeam.id, userId: adminUser.id, role: Role.ADMIN },
      { teamId: platformTeam.id, userId: platformLead.id, role: Role.LEAD },
      { teamId: platformTeam.id, userId: devMember.id, role: Role.MEMBER },
      { teamId: platformTeam.id, userId: juniorMember.id, role: Role.MEMBER },
      { teamId: platformTeam.id, userId: auditorViewer.id, role: Role.VIEWER },

      // Incident Response team memberships
      { teamId: incidentTeam.id, userId: adminUser.id, role: Role.ADMIN },
      { teamId: incidentTeam.id, userId: incidentLead.id, role: Role.LEAD },
      { teamId: incidentTeam.id, userId: platformLead.id, role: Role.VIEWER }, // Cross-role demonstration!
      { teamId: incidentTeam.id, userId: devMember.id, role: Role.MEMBER },
      { teamId: incidentTeam.id, userId: auditorViewer.id, role: Role.VIEWER },
    ],
  });

  // 4. Seed Work Items & Activities
  console.log('📋 Seeding work items and audit history...');

  // Item 1: Unassigned Urgent in Incident Response (Tests "Unassigned Urgent" dashboard)
  const urgentIncident = await prisma.workItem.create({
    data: {
      title: 'PostgreSQL Connection Pool Saturation in us-east-1',
      description: 'Connection pool exhausted due to idle clients during load spike. Requires immediate tuning of max_connections and PgBouncer pool sizing.',
      type: WorkItemType.INCIDENT,
      priority: WorkItemPriority.URGENT,
      status: WorkItemStatus.OPEN,
      teamId: incidentTeam.id,
      creatorId: incidentLead.id,
      assigneeId: null,
      dueDate: new Date(Date.now() + 4 * 3600 * 1000), // Due in 4 hours
      version: 1,
    },
  });

  await prisma.activityLog.create({
    data: {
      workItemId: urgentIncident.id,
      actorId: incidentLead.id,
      action: ActivityAction.CREATED,
      newValue: WorkItemStatus.OPEN,
      metadata: { priority: 'URGENT', note: 'Reported by Datadog Alert' },
    },
  });

  // Item 2: Awaiting Approval in Platform Ops (Tests "Awaiting My Approval" dashboard)
  const approvalItem = await prisma.workItem.create({
    data: {
      title: 'Upgrade Kubernetes Ingress Controller to v1.11.0',
      description: 'Helm chart upgrade prepared and tested in staging. Awaiting Platform Lead approval before deploying to production clusters.',
      type: WorkItemType.OPERATIONAL_REQUEST,
      priority: WorkItemPriority.HIGH,
      status: WorkItemStatus.AWAITING_APPROVAL,
      teamId: platformTeam.id,
      creatorId: devMember.id,
      assigneeId: devMember.id,
      dueDate: new Date(Date.now() + 24 * 3600 * 1000),
      version: 2,
    },
  });

  await prisma.activityLog.createMany({
    data: [
      {
        workItemId: approvalItem.id,
        actorId: devMember.id,
        action: ActivityAction.CREATED,
        newValue: WorkItemStatus.OPEN,
      },
      {
        workItemId: approvalItem.id,
        actorId: devMember.id,
        action: ActivityAction.CLAIMED,
        oldValue: 'null',
        newValue: devMember.id,
      },
      {
        workItemId: approvalItem.id,
        actorId: devMember.id,
        action: ActivityAction.STATUS_CHANGED,
        oldValue: WorkItemStatus.IN_PROGRESS,
        newValue: WorkItemStatus.AWAITING_APPROVAL,
        metadata: { justification: 'Staging verification successful. Ready for prod gatekeeper approval.' },
      },
    ],
  });

  await prisma.comment.create({
    data: {
      workItemId: approvalItem.id,
      authorId: devMember.id,
      content: 'Staging soak test passed with 0 dropped packets over 12 hours. Change ticket reference #CHG-4921.',
    },
  });

  // Item 3: In Progress assigned to devMember (Tests "Assigned to Me" dashboard)
  const assignedItem = await prisma.workItem.create({
    data: {
      title: 'Audit and Rotate Stale IAM Service Account Keys',
      description: 'Quarterly compliance review of automated pipeline service accounts older than 90 days.',
      type: WorkItemType.TASK,
      priority: WorkItemPriority.MEDIUM,
      status: WorkItemStatus.IN_PROGRESS,
      teamId: platformTeam.id,
      creatorId: adminUser.id,
      assigneeId: devMember.id,
      dueDate: new Date(Date.now() + 48 * 3600 * 1000),
      version: 2,
    },
  });

  await prisma.activityLog.createMany({
    data: [
      {
        workItemId: assignedItem.id,
        actorId: adminUser.id,
        action: ActivityAction.CREATED,
        newValue: WorkItemStatus.OPEN,
      },
      {
        workItemId: assignedItem.id,
        actorId: devMember.id,
        action: ActivityAction.CLAIMED,
        oldValue: 'null',
        newValue: devMember.id,
      },
    ],
  });

  // Item 4: Resolved task
  const resolvedItem = await prisma.workItem.create({
    data: {
      title: 'Fix Memory Leak in Metric Collection Agent',
      description: 'Prometheus exporter node memory leak patched by upgrading to v0.18.2.',
      type: WorkItemType.BUG,
      priority: WorkItemPriority.HIGH,
      status: WorkItemStatus.RESOLVED,
      teamId: platformTeam.id,
      creatorId: juniorMember.id,
      assigneeId: juniorMember.id,
      version: 3,
    },
  });

  await prisma.activityLog.createMany({
    data: [
      {
        workItemId: resolvedItem.id,
        actorId: juniorMember.id,
        action: ActivityAction.CREATED,
        newValue: WorkItemStatus.OPEN,
      },
      {
        workItemId: resolvedItem.id,
        actorId: juniorMember.id,
        action: ActivityAction.CLAIMED,
        newValue: juniorMember.id,
      },
      {
        workItemId: resolvedItem.id,
        actorId: platformLead.id,
        action: ActivityAction.APPROVED,
        oldValue: WorkItemStatus.AWAITING_APPROVAL,
        newValue: WorkItemStatus.RESOLVED,
        metadata: { reviewer: 'Elena Rostova', verdict: 'Approved' },
      },
    ],
  });

  console.log('✅ Seeding completed successfully!');
  console.log('\n--- Seeded Demo Credentials (Password for all: password123) ---');
  console.log('1. Admin:           admin@opsflow.io           (Admin: Platform Ops & Incident Response)');
  console.log('2. Platform Lead:   lead.platform@opsflow.io   (Lead: Platform Ops | Viewer: Incident Response)');
  console.log('3. Incident Lead:   lead.incident@opsflow.io   (Lead: Incident Response)');
  console.log('4. Senior SRE:      member.dev@opsflow.io      (Member: Platform Ops & Incident Response)');
  console.log('5. Ops Associate:   member.junior@opsflow.io   (Member: Platform Ops)');
  console.log('6. Auditor:         viewer.audit@opsflow.io    (Viewer: Platform Ops & Incident Response)');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
