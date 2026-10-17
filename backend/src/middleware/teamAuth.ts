import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../config/db';
import { ApiError } from '../utils/errors';

export const ROLE_HIERARCHY: Record<Role, number> = {
  [Role.VIEWER]: 1,
  [Role.MEMBER]: 2,
  [Role.LEAD]: 3,
  [Role.ADMIN]: 4,
};

export function hasMinimumRole(userRole: Role, minimumRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minimumRole];
}

/**
 * Middleware: Verifies that the authenticated user has an active membership in the team
 * extracted from route params, request body, or query.
 * Always queries the live database to guarantee revoked memberships are immediately denied.
 */
export function requireTeamMembership(
  teamIdExtractor?: (req: Request) => string | undefined
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw ApiError.unauthorized('Authentication required before checking team permissions');
      }

      const teamId = teamIdExtractor
        ? teamIdExtractor(req)
        : req.params.teamId || req.body.teamId || (req.query.teamId as string);

      if (!teamId) {
        throw ApiError.badRequest('Team identifier (teamId) is required for this operation');
      }

      const membership = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId: req.user.id,
          },
        },
      });

      if (!membership) {
        throw ApiError.forbidden('Access denied: You are not a member of this team or your membership has been revoked');
      }

      req.teamMember = membership;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware: Requires the authenticated user's team membership role to be within the allowed roles.
 * Must be executed after requireTeamMembership or resolveWorkItemTeam.
 */
export function requireTeamRole(allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.teamMember) {
        throw ApiError.internal('requireTeamRole was invoked without prior team membership resolution');
      }

      if (!allowedRoles.includes(req.teamMember.role)) {
        throw ApiError.forbidden(
          `Access denied: Your role (${req.teamMember.role}) does not have permission to perform this action. Required: ${allowedRoles.join(', ')}`
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware: Resolves a WorkItem by :id param, verifies team membership, and attaches
 * both req.workItem and req.teamMember to the request.
 */
export async function resolveWorkItemTeam(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required');
    }

    const id = req.params.id as string;
    if (!id) {
      throw ApiError.badRequest('Work item id parameter is required');
    }

    const workItem = await prisma.workItem.findUnique({
      where: { id },
    });

    if (!workItem) {
      throw ApiError.notFound('Work item not found');
    }

    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: workItem.teamId,
          userId: req.user.id,
        },
      },
    });

    if (!membership) {
      throw ApiError.forbidden('Access denied: You do not have access to this work item because you are not a member of the owning team');
    }

    req.workItem = workItem;
    req.teamMember = membership;
    next();
  } catch (error) {
    next(error);
  }
}
