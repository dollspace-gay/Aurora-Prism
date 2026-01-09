import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock queryClient before importing api
vi.mock('../../client/src/lib/queryClient', () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
  },
}));

// Save original fetch
const originalFetch = global.fetch;

describe('API Client', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('CSRF token management', () => {
    it('should fetch CSRF token on initialization', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
      });

      await import('../../client/src/lib/api');
      await new Promise((r) => setTimeout(r, 10));

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/csrf-token',
        expect.objectContaining({
          credentials: 'include',
        })
      );
    });
  });

  describe('HTTP methods', () => {
    it('should make GET requests', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: 'test' }),
        });

      const { api } = await import('../../client/src/lib/api');
      await new Promise((r) => setTimeout(r, 10));

      const result = await api.get('/api/test');
      expect(result).toEqual({ data: 'test' });
    });

    it('should make POST requests with body', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
        });

      const { api } = await import('../../client/src/lib/api');
      await new Promise((r) => setTimeout(r, 10));

      const result = await api.post('/api/test', { name: 'test' });
      expect(result).toEqual({ success: true });
    });

    it('should make PUT requests', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ updated: true }),
        });

      const { api } = await import('../../client/src/lib/api');
      await new Promise((r) => setTimeout(r, 10));

      const result = await api.put('/api/test/1', { name: 'updated' });
      expect(result).toEqual({ updated: true });
    });

    it('should make DELETE requests', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ deleted: true }),
        });

      const { api } = await import('../../client/src/lib/api');
      await new Promise((r) => setTimeout(r, 10));

      const result = await api.delete('/api/test/1');
      expect(result).toEqual({ deleted: true });
    });

    it('should handle 204 No Content responses', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
        });

      const { api } = await import('../../client/src/lib/api');
      await new Promise((r) => setTimeout(r, 10));

      const result = await api.delete('/api/test/1');
      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should throw error on non-OK response', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Internal Server Error' }),
        });

      const { api } = await import('../../client/src/lib/api');
      await new Promise((r) => setTimeout(r, 10));

      await expect(api.get('/api/test')).rejects.toThrow(
        'HTTP error! status: 500'
      );
    });

    it('should retry on CSRF validation failure', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'old-token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ error: 'CSRF validation failed' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'new-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
        });

      const { api } = await import('../../client/src/lib/api');
      await new Promise((r) => setTimeout(r, 10));

      const result = await api.post('/api/test', { data: 'test' });
      expect(result).toEqual({ success: true });
    });

    it('should invalidate session cache on 401', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Unauthorized' }),
        });

      const { queryClient } = await import('../../client/src/lib/queryClient');
      const { api } = await import('../../client/src/lib/api');
      await new Promise((r) => setTimeout(r, 10));

      await expect(api.get('/api/test')).rejects.toThrow();

      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['/api/auth/session'],
      });
    });
  });

  describe('credentials handling', () => {
    it('should always include credentials for cookie-based auth', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: 'test' }),
        });

      const { api } = await import('../../client/src/lib/api');
      await new Promise((r) => setTimeout(r, 10));

      await api.get('/api/test');

      const getCall = mockFetch.mock.calls.find(
        (call) => call[0] === '/api/test'
      );
      expect(getCall?.[1]?.credentials).toBe('include');
    });
  });
});
