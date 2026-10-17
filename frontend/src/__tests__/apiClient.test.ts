import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, request, tokenStorage, setUnauthorizedHandler, ApiClientError } from '../api/client';

describe('Frontend API Client & Storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('stores and retrieves JWT tokens exclusively in sessionStorage', () => {
    expect(tokenStorage.get()).toBeNull();
    tokenStorage.set('test-jwt-token-123');
    expect(tokenStorage.get()).toBe('test-jwt-token-123');
    tokenStorage.remove();
    expect(tokenStorage.get()).toBeNull();
  });

  it('automatically adds Authorization Bearer header when token is present', async () => {
    tokenStorage.set('active-session-jwt');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: { user: { id: 'u1', name: 'Alex' } } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request('/api/v1/auth/me');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );

    const calledHeaders = mockFetch.mock.calls[0][1].headers as Headers;
    expect(calledHeaders.get('Authorization')).toBe('Bearer active-session-jwt');
    expect(res.data).toEqual({ user: { id: 'u1', name: 'Alex' } });
  });

  it('injects Idempotency-Key header when supplied', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: { workItem: { id: 'wi-1' } } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const testIdempotencyKey = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    await request('/api/v1/work-items', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test Task' }),
      idempotencyKey: testIdempotencyKey,
    });

    const calledHeaders = mockFetch.mock.calls[0][1].headers as Headers;
    expect(calledHeaders.get('Idempotency-Key')).toBe(testIdempotencyKey);
  });

  it('correctly maps standard backend error shapes into ApiClientError', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: false,
        error: {
          message: 'Request validation failed',
          details: [{ field: 'title', message: 'Title must be at least 3 characters' }],
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(request('/api/v1/work-items', { method: 'POST' })).rejects.toThrow(
      'Request validation failed'
    );

    try {
      await request('/api/v1/work-items', { method: 'POST' });
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect(err.statusCode).toBe(400);
      expect(err.details).toEqual([
        { field: 'title', message: 'Title must be at least 3 characters' },
      ]);
    }
  });

  it('handles HTTP 401 Unauthorized by clearing session token and triggering logout callback', async () => {
    tokenStorage.set('expired-token');
    const unauthorizedHandler = vi.fn();
    setUnauthorizedHandler(unauthorizedHandler);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: false,
        error: { message: 'Token has expired' },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(request('/api/v1/dashboard')).rejects.toThrow('Token has expired');
    expect(tokenStorage.get()).toBeNull();
    expect(unauthorizedHandler).toHaveBeenCalledTimes(1);
  });
});
