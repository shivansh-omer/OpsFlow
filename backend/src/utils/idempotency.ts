import crypto from 'crypto';
import { ApiError } from './errors';

/**
 * Recursively sorts keys of an object to produce deterministic JSON serialization
 */
export function canonicalizeJson(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalizeJson);
  }

  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const result: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    result[key] = canonicalizeJson((obj as Record<string, unknown>)[key]);
  }

  return result;
}

/**
 * Computes a deterministic SHA-256 fingerprint for a request
 */
export function computeFingerprint(method: string, path: string, body: unknown): string {
  const canonicalBody = JSON.stringify(canonicalizeJson(body) || {});
  const normalizedPath = path.toLowerCase().replace(/\/+$/, '');
  const raw = `${method.toUpperCase()}:${normalizedPath}:${canonicalBody}`;

  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Validates the Idempotency-Key header value
 */
export function validateIdempotencyKey(key: string | undefined): string | null {
  if (!key) return null;

  const trimmed = key.trim();
  if (trimmed.length < 8 || trimmed.length > 128) {
    throw ApiError.badRequest('Idempotency-Key must be between 8 and 128 characters long');
  }

  // Allowed characters: alphanumeric, hyphens, underscores
  if (!/^[a-zA-Z0-9_\-]+$/.test(trimmed)) {
    throw ApiError.badRequest(
      'Idempotency-Key may only contain alphanumeric characters, hyphens, and underscores'
    );
  }

  return trimmed;
}
