import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './errors';

export interface TokenPayload {
  userId: string;
  email: string;
}

export function generateToken(payload: TokenPayload, expiresIn: string | number = '8h'): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as TokenPayload;

    if (!decoded.userId || !decoded.email) {
      throw ApiError.unauthorized('Token payload is missing required identity claims');
    }

    return {
      userId: decoded.userId,
      email: decoded.email,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Authentication token has expired. Please log in again.');
    }
    throw ApiError.unauthorized('Invalid authentication token');
  }
}
