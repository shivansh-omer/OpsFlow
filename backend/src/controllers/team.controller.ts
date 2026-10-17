import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db';
import { ApiError } from '../utils/errors';

export async function getMyTeams(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required');
    }

    const memberships = await prisma.teamMember.findMany({
      where: { userId: req.user.id },
      include: {
        team: {
          include: {
            _count: {
              select: {
                members: true,
                workItems: true,
              },
            },
          },
        },
      },
      orderBy: {
        joinedAt: 'asc',
      },
    });

    const teams = memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      slug: m.team.slug,
      description: m.team.description,
      myRole: m.role,
      joinedAt: m.joinedAt,
      stats: {
        memberCount: m.team._count.members,
        workItemCount: m.team._count.workItems,
      },
    }));

    res.status(200).json({
      success: true,
      data: {
        teams,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getTeamMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const teamId = req.params.teamId as string;

    const members = await prisma.teamMember.findMany({
      where: { teamId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        joinedAt: 'asc',
      },
    });

    res.status(200).json({
      success: true,
      data: {
        teamId,
        members: members.map((m) => ({
          id: m.id,
          role: m.role,
          joinedAt: m.joinedAt,
          user: m.user,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}
