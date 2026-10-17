import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { prisma } from '../config/db';
import { ApiError } from '../utils/errors';

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Authentication token is required. Use format: Authorization: Bearer <token>');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw ApiError.unauthorized('Authentication token is missing');
    }

    const payload = verifyToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      throw ApiError.unauthorized('User associated with this token no longer exists');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
