import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock queryClient before importing api
vi.mock('../../client/src/lib/queryClient', () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
  },
}));

describe('API Module', () => {
  let originalFetch: typeof global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    originalFetch = global.fetch;
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Default mock for CSRF token fetch
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/csrf-token') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe('CSRF Token Management', () => {
    it('should fetch CSRF token on module load', async () => {
      const { api } = await import('../../client/src/lib/api');

      // Wait for initial token fetch
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockFetch).toHaveBeenCalledWith('/api/csrf-token', expect.any(Object));
    });

    it('should cache CSRF token after first fetch', async () => {
      const { api } = await import('../../client/src/lib/api');

      // Make two requests
      await api.post('/test1', {});
      await api.post('/test2', {});

      // CSRF token should only be fetched once (initial load)
      const csrfCalls = mockFetch.mock.calls.filter(
        (call) => call[0] === '/api/csrf-token'
      );
      expect(csrfCalls.length).toBe(1);
    });

    it('should include CSRF token in POST requests', async () => {
      const { api } = await import('../../client/src/lib/api');

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/api/csrf-token') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
        });
      });

      await api.post('/test', { data: 'value' });

      const postCall = mockFetch.mock.calls.find((call) => call[0] === '/test');
      expect(postCall).toBeDefined();
      expect(postCall[1].headers['X-CSRF-Token']).toBe('test-csrf-token');
    });

    it('should not include CSRF token in GET requests', async () => {
      const { api } = await import('../../client/src/lib/api');

      await api.get('/test');

      const getCall = mockFetch.mock.calls.find((call) => call[0] === '/test');
      expect(getCall).toBeDefined();
      expect(getCall[1].headers['X-CSRF-Token']).toBeUndefined();
    });

    it('should refresh CSRF token on 403 with CSRF error', async () => {
      let csrfFetchCount = 0;

      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/csrf-token') {
          csrfFetchCount++;
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ csrfToken: `csrf-token-${csrfFetchCount}` }),
          });
        }
        if (url === '/test') {
          // First call fails with CSRF error, second succeeds
          if (csrfFetchCount === 1) {
            return Promise.resolve({
              ok: false,
              status: 403,
              json: () => Promise.resolve({ error: 'CSRF validation failed' }),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ success: true }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      const { api } = await import('../../client/src/lib/api');

      const result = await api.post('/test', {});

      expect(result).toEqual({ success: true });
      expect(csrfFetchCount).toBe(2); // Initial + refresh
    });
  });

  describe('HTTP Methods', () => {
    beforeEach(async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/csrf-token') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: 'response' }),
        });
      });
    });

    it('should make GET requests', async () => {
      const { api } = await import('../../client/src/lib/api');

      const result = await api.get('/api/test');

      const getCall = mockFetch.mock.calls.find(
        (call) => call[0] === '/api/test'
      );
      expect(getCall[1].method).toBe('GET');
      expect(result).toEqual({ data: 'response' });
    });

    it('should make POST requests with body', async () => {
      const { api } = await import('../../client/src/lib/api');

      await api.post('/api/test', { key: 'value' });

      const postCall = mockFetch.mock.calls.find(
        (call) => call[0] === '/api/test'
      );
      expect(postCall[1].method).toBe('POST');
      expect(postCall[1].body).toBe(JSON.stringify({ key: 'value' }));
    });

    it('should make PUT requests with body', async () => {
      const { api } = await import('../../client/src/lib/api');

      await api.put('/api/test', { key: 'updated' });

      const putCall = mockFetch.mock.calls.find(
        (call) => call[0] === '/api/test'
      );
      expect(putCall[1].method).toBe('PUT');
      expect(putCall[1].body).toBe(JSON.stringify({ key: 'updated' }));
    });

    it('should make DELETE requests', async () => {
      const { api } = await import('../../client/src/lib/api');

      await api.delete('/api/test');

      const deleteCall = mockFetch.mock.calls.find(
        (call) => call[0] === '/api/test'
      );
      expect(deleteCall[1].method).toBe('DELETE');
    });

    it('should include credentials in all requests', async () => {
      const { api } = await import('../../client/src/lib/api');

      await api.get('/api/test');

      const call = mockFetch.mock.calls.find((call) => call[0] === '/api/test');
      expect(call[1].credentials).toBe('include');
    });

    it('should set Content-Type header', async () => {
      const { api } = await import('../../client/src/lib/api');

      await api.post('/api/test', {});

      const call = mockFetch.mock.calls.find((call) => call[0] === '/api/test');
      expect(call[1].headers['Content-Type']).toBe('application/json');
    });
  });

  describe('Error Handling', () => {
    it('should throw error on non-ok response', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/csrf-token') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ csrfToken: 'test' }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ message: 'Server error' }),
        });
      });

      const { api } = await import('../../client/src/lib/api');

      await expect(api.get('/api/test')).rejects.toThrow(
        'HTTP error! status: 500'
      );
    });

    it('should attach error data to thrown error', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/csrf-token') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ csrfToken: 'test' }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: 'Bad request', details: 'Invalid input' }),
        });
      });

      const { api } = await import('../../client/src/lib/api');

      try {
        await api.get('/api/test');
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        const err = error as Error & { data?: unknown };
        expect(err.data).toEqual({ error: 'Bad request', details: 'Invalid input' });
      }
    });

    it('should handle unparseable error response', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/csrf-token') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ csrfToken: 'test' }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.reject(new Error('Invalid JSON')),
        });
      });

      const { api } = await import('../../client/src/lib/api');

      try {
        await api.get('/api/test');
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        const err = error as Error & { data?: unknown };
        expect(err.data).toEqual({ message: 'Could not parse error response.' });
      }
    });

    it('should invalidate session queries on 401', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/csrf-token') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ csrfToken: 'test' }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Unauthorized' }),
        });
      });

      const { api } = await import('../../client/src/lib/api');
      const { queryClient } = await import('../../client/src/lib/queryClient');

      try {
        await api.get('/api/protected');
      } catch {
        // Expected to throw
      }

      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['/api/auth/session'],
      });
    });
  });

  describe('Response Handling', () => {
    it('should return null for 204 No Content', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/csrf-token') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ csrfToken: 'test' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 204,
          json: () => Promise.reject(new Error('No content')),
        });
      });

      const { api } = await import('../../client/src/lib/api');

      const result = await api.delete('/api/resource');

      expect(result).toBeNull();
    });

    it('should parse JSON response for successful requests', async () => {
      const responseData = { id: 1, name: 'Test', nested: { value: true } };

      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/csrf-token') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ csrfToken: 'test' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(responseData),
        });
      });

      const { api } = await import('../../client/src/lib/api');

      const result = await api.get('/api/test');

      expect(result).toEqual(responseData);
    });
  });

  describe('refreshCSRFToken', () => {
    it('should be exported and callable', async () => {
      const { refreshCSRFToken } = await import('../../client/src/lib/api');

      expect(typeof refreshCSRFToken).toBe('function');
    });

    it('should clear cached token and fetch new one', async () => {
      let fetchCount = 0;

      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/csrf-token') {
          fetchCount++;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ csrfToken: `token-${fetchCount}` }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      const { refreshCSRFToken } = await import('../../client/src/lib/api');

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 10));
      const initialCount = fetchCount;

      const newToken = await refreshCSRFToken();

      expect(fetchCount).toBe(initialCount + 1);
      expect(newToken).toBe(`token-${fetchCount}`);
    });
  });
});
