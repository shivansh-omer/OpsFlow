import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/errors';
import { env } from '../config/env';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));

    res.status(400).json({
      success: false,
      error: {
        message: 'Request validation failed',
        details: formattedErrors,
      },
    });
    return;
  }

  // Fallback for unhandled unexpected errors
  if (env.NODE_ENV !== 'test') {
    console.error('Unhandled server error:', err);
  }

  res.status(500).json({
    success: false,
    error: {
      message: 'An unexpected internal server error occurred',
      ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
    },
  });
}
