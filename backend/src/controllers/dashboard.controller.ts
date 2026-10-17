import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { dashboardService } from '../services/dashboard.service';
import { ApiError } from '../utils/errors';

export const getDashboardQuerySchema = z.object({
  teamId: z.string().uuid('Invalid teamId format').optional(),
});

export async function getDashboard(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required');
    }

    const { teamId } = req.query as { teamId?: string };
    const data = await dashboardService.getDashboardData(req.user.id, teamId);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}
