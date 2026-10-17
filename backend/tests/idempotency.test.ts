import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/app';
import { prisma } from '../src/config/db';
import { generateToken } from '../src/utils/jwt';
import { WorkItemPriority, WorkItemType } from '@prisma/client';

describe('Idempotency Engine (/api/v1/work-items with Idempotency-Key)', () => {
  let platformTeamId: string;

  let devMemberToken: string;
  let juniorMemberToken: string;
  let devMemberId: string;
  let juniorMemberId: string;

  beforeAll(async () => {
    const platformTeam = await prisma.team.findUniqueOrThrow({ where: { slug: 'platform-ops' } });
    platformTeamId = platformTeam.id;

    const [devMember, juniorMember] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: 'member.dev@opsflow.io' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'member.junior@opsflow.io' } }),
    ]);

    devMemberId = devMember.id;
    juniorMemberId = juniorMember.id;

    devMemberToken = generateToken({ userId: devMember.id, email: devMember.email });
    juniorMemberToken = generateToken({ userId: juniorMember.id, email: juniorMember.email });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. Repeated creation with the same key and identical payload returns original cached response and creates exactly ONE work item', async () => {
    const idempotencyKey = `idem-key-${crypto.randomUUID()}`;
    const payload = {
      title: 'Configure Automated Canary Analysis in Spinnaker',
      description: 'Setup Kayenta judge metric thresholds for 5% canary rollouts.',
      type: WorkItemType.TASK,
      priority: WorkItemPriority.HIGH,
      teamId: platformTeamId,
    };

    // First Request
    const res1 = await request(app)
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${devMemberToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res1.status).toBe(201);
    expect(res1.body.success).toBe(true);
    expect(res1.headers['x-cache-lookup']).toBeUndefined();
    const createdId = res1.body.data.workItem.id;

    // Second Repeated Request with identical key & payload
    const res2 = await request(app)
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${devMemberToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res2.status).toBe(201);
    expect(res2.headers['x-cache-lookup']).toBe('HIT');
    expect(res2.body.data.workItem.id).toBe(createdId);

    // Database verification: Exactly ONE item created
    const count = await prisma.workItem.count({
      where: { title: payload.title },
    });
    expect(count).toBe(1);

    // Idempotency record verification
    const record = await prisma.idempotencyRecord.findUnique({
      where: { key_userId: { key: idempotencyKey, userId: devMemberId } },
    });
    expect(record).not.toBeNull();
    expect(record?.statusCode).toBe(201);
  });

  it('2. Reusing an idempotency key with a DIFFERENT payload returns 422 Unprocessable Entity', async () => {
    const idempotencyKey = `idem-conflict-${crypto.randomUUID()}`;

    // Request 1
    const res1 = await request(app)
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${devMemberToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        title: 'Original Task Specification',
        description: 'Original description content',
        teamId: platformTeamId,
      });

    expect(res1.status).toBe(201);

    // Request 2 with SAME key but conflicting payload
    const res2 = await request(app)
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${devMemberToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        title: 'Tampered Task Specification',
        description: 'Mismatched payload attempting key hijacking',
        teamId: platformTeamId,
      });

    expect(res2.status).toBe(422);
    expect(res2.body.success).toBe(false);
    expect(res2.body.error.message).toContain('different request payload');
  });

  it('3. Handles simultaneous overlapping creation requests with the same key safely without duplicates', async () => {
    const idempotencyKey = `idem-race-${crypto.randomUUID()}`;
    const payload = {
      title: 'Simultaneous Duplicate Submission Under Pressure',
      description: 'Simulates network retry or double-click on form submit.',
      teamId: platformTeamId,
    };

    // Dispatch two concurrent requests with identical key and payload
    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/v1/work-items')
        .set('Authorization', `Bearer ${devMemberToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload),
      request(app)
        .post('/api/v1/work-items')
        .set('Authorization', `Bearer ${devMemberToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload),
    ]);

    expect([201, 200]).toContain(res1.status);
    expect([201, 200]).toContain(res2.status);

    // Both requests must reference the same single work item ID
    const id1 = res1.body.data.workItem.id;
    const id2 = res2.body.data.workItem.id;
    expect(id1).toBe(id2);

    // Database verification: Only 1 work item created
    const count = await prisma.workItem.count({
      where: { title: payload.title },
    });
    expect(count).toBe(1);
  });

  it('4. Rejects invalid Idempotency-Key formats with 400 Bad Request', async () => {
    // Too short (less than 8 chars)
    const resShort = await request(app)
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${devMemberToken}`)
      .set('Idempotency-Key', 'short')
      .send({
        title: 'Valid title',
        description: 'Valid description',
        teamId: platformTeamId,
      });

    expect(resShort.status).toBe(400);
    expect(resShort.body.error.message).toContain('between 8 and 128 characters');

    // Invalid characters (spaces, special chars)
    const resInvalid = await request(app)
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${devMemberToken}`)
      .set('Idempotency-Key', 'invalid key with spaces!@#')
      .send({
        title: 'Valid title',
        description: 'Valid description',
        teamId: platformTeamId,
      });

    expect(resInvalid.status).toBe(400);
    expect(resInvalid.body.error.message).toContain('only contain alphanumeric characters');
  });

  it('5. Scopes idempotency keys to the authenticated user (different users can use same key string without collision)', async () => {
    const sharedKey = `shared-client-generated-key-${Date.now()}`;
    const payload = {
      title: 'Shared Client Key Across Independent Users',
      description: 'Scoped to user identity in database',
      teamId: platformTeamId,
    };

    // DevMember creates with key
    const res1 = await request(app)
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${devMemberToken}`)
      .set('Idempotency-Key', sharedKey)
      .send(payload);

    expect(res1.status).toBe(201);

    // JuniorMember creates with SAME key string
    const res2 = await request(app)
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${juniorMemberToken}`)
      .set('Idempotency-Key', sharedKey)
      .send(payload);

    expect(res2.status).toBe(201);

    // Because keys are scoped to userId, two distinct items are created
    expect(res1.body.data.workItem.id).not.toBe(res2.body.data.workItem.id);
    expect(res1.body.data.workItem.creator.id).toBe(devMemberId);
    expect(res2.body.data.workItem.creator.id).toBe(juniorMemberId);
  });
});
