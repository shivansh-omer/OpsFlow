import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { generateToken } from '../utils/jwt';
import { ApiError } from '../utils/errors';

export const loginSchema = z.object({
  email: z.string().email('Valid email address is required'),
  password: z.string().min(1, 'Password is required'),
});

export const DEMO_PERSONAS = {
  admin: 'admin@opsflow.io',
  'lead-platform': 'lead.platform@opsflow.io',
  'lead-incident': 'lead.incident@opsflow.io',
  'member-dev': 'member.dev@opsflow.io',
  'member-junior': 'member.junior@opsflow.io',
  viewer: 'viewer.audit@opsflow.io',
} as const;

export type DemoPersonaKey = keyof typeof DEMO_PERSONAS;

export const demoLoginSchema = z.object({
  persona: z.enum(
    ['admin', 'lead-platform', 'lead-incident', 'member-dev', 'member-junior', 'viewer'] as const,
    {
      errorMap: () => ({
        message: 'Invalid persona. Allowed: admin, lead-platform, lead-incident, member-dev, member-junior, viewer',
      }),
    }
  ),
});

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
    });

    res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function demoLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Strict requirement: Never allow demo login endpoint in production
    if (env.NODE_ENV === 'production') {
      throw ApiError.notFound('Demo authentication is disabled in production environments');
    }

    const { persona } = req.body as { persona: DemoPersonaKey };
    const targetEmail = DEMO_PERSONAS[persona];

    if (!targetEmail) {
      throw ApiError.badRequest(`Unknown demo persona: ${persona}`);
    }

    const user = await prisma.user.findUnique({
      where: { email: targetEmail },
    });

    if (!user) {
      throw ApiError.notFound(`Demo user '${targetEmail}' was not found. Please ensure database is seeded.`);
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
    });

    res.status(200).json({
      success: true,
      data: {
        token,
        persona,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required');
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        memberships: {
          include: {
            team: true,
          },
        },
      },
    });

    if (!user) {
      throw ApiError.unauthorized('User record not found');
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          createdAt: user.createdAt,
          memberships: user.memberships.map((m) => ({
            id: m.id,
            teamId: m.teamId,
            teamName: m.team.name,
            teamSlug: m.team.slug,
            role: m.role,
            joinedAt: m.joinedAt,
          })),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}
