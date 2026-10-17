import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app';
import { env } from '../src/config/env';

describe('Authentication API (/api/v1/auth)', () => {
  describe('POST /api/v1/auth/login', () => {
    it('returns 200, JWT token, and user profile on valid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@opsflow.io',
          password: 'password123',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(typeof res.body.data.token).toBe('string');
      expect(res.body.data.user).toMatchObject({
        email: 'admin@opsflow.io',
        name: expect.stringContaining('Admin'),
      });
      // Ensure password hash is NEVER leaked in response
      expect(res.body.data.user.passwordHash).toBeUndefined();
    });

    it('returns 401 when password is incorrect', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@opsflow.io',
          password: 'wrongpassword',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('returns 401 for unknown user email without leaking account existence', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@opsflow.io',
          password: 'password123',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('returns 400 when email format is invalid', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'not-an-email',
          password: 'password123',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Request validation failed');
    });
  });

  describe('POST /api/v1/auth/demo-login', () => {
    it('returns 200 and token for valid seeded demo persona in development', async () => {
      const res = await request(app)
        .post('/api/v1/auth/demo-login')
        .send({ persona: 'lead-platform' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.persona).toBe('lead-platform');
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.email).toBe('lead.platform@opsflow.io');
    });

    it('returns 400 for unknown demo persona', async () => {
      const res = await request(app)
        .post('/api/v1/auth/demo-login')
        .send({ persona: 'hacker-persona' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects demo login when NODE_ENV is production', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalEnvNodeEnv = env.NODE_ENV;
      try {
        // Temporarily mutate to production
        (env as { NODE_ENV: string }).NODE_ENV = 'production';

        const res = await request(app)
          .post('/api/v1/auth/demo-login')
          .send({ persona: 'admin' });

        expect(res.status).toBe(404);
        expect(res.body.error.message).toContain('Demo authentication is disabled in production');
      } finally {
        (env as { NODE_ENV: string }).NODE_ENV = originalEnvNodeEnv;
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('Authentication token is required');
    });

    it('returns 401 when token is malformed', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.payload');

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid authentication token');
    });

    it('returns 401 when token is expired', async () => {
      // Craft an expired token
      const expiredToken = jwt.sign(
        { userId: 'test-id', email: 'test@opsflow.io' },
        env.JWT_SECRET,
        { expiresIn: '-1s' }
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('Authentication token has expired');
    });

    it('returns 401 when token was signed with an untrusted or forged secret', async () => {
      const forgedToken = jwt.sign(
        { userId: 'admin-id', email: 'admin@opsflow.io' },
        'untrusted-attacker-secret-key-32chars',
        { algorithm: 'HS256', expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${forgedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid authentication token');
    });

    it('returns 401 when token payload is missing required identity claims', async () => {
      const emptyPayloadToken = jwt.sign(
        { someOtherField: 'value' },
        env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${emptyPayloadToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('missing required identity claims');
    });

    it('returns 200, user identity, and team memberships for a valid token', async () => {
      // Login first
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'lead.platform@opsflow.io',
          password: 'password123',
        });

      const token = loginRes.body.data.token;

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('lead.platform@opsflow.io');
      expect(Array.isArray(res.body.data.user.memberships)).toBe(true);
      expect(res.body.data.user.memberships.length).toBe(2);

      const roles = res.body.data.user.memberships.map((m: { teamSlug: string; role: string }) => ({
        slug: m.teamSlug,
        role: m.role,
      }));

      expect(roles).toContainEqual({ slug: 'platform-ops', role: 'LEAD' });
      expect(roles).toContainEqual({ slug: 'incident-response', role: 'VIEWER' });
    });
  });
});
