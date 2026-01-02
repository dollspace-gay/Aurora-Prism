import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the api module
vi.mock('../../client/src/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

describe('queryClient module', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getQueryFn', () => {
    it('should create a query function', async () => {
      const { getQueryFn } = await import('../../client/src/lib/queryClient');
      const queryFn = getQueryFn();

      expect(typeof queryFn).toBe('function');
    });

    it('should call api.get with joined query key', async () => {
      const { api } = await import('../../client/src/lib/api');
      const { getQueryFn } = await import('../../client/src/lib/queryClient');

      vi.mocked(api.get).mockResolvedValue({ data: 'test' });

      const queryFn = getQueryFn();
      const result = await queryFn({
        queryKey: ['/api', 'users', '123'],
        meta: undefined,
        signal: new AbortController().signal,
      });

      expect(api.get).toHaveBeenCalledWith('/api/users/123');
      expect(result).toEqual({ data: 'test' });
    });

    it('should handle single segment query key', async () => {
      const { api } = await import('../../client/src/lib/api');
      const { getQueryFn } = await import('../../client/src/lib/queryClient');

      vi.mocked(api.get).mockResolvedValue({ success: true });

      const queryFn = getQueryFn();
      await queryFn({
        queryKey: ['/api/health'],
        meta: undefined,
        signal: new AbortController().signal,
      });

      expect(api.get).toHaveBeenCalledWith('/api/health');
    });

    it('should throw errors by default', async () => {
      const { api } = await import('../../client/src/lib/api');
      const { getQueryFn } = await import('../../client/src/lib/queryClient');

      const error = new Error('Request failed');
      vi.mocked(api.get).mockRejectedValue(error);

      const queryFn = getQueryFn();

      await expect(
        queryFn({
          queryKey: ['/api/test'],
          meta: undefined,
          signal: new AbortController().signal,
        })
      ).rejects.toThrow('Request failed');
    });

    it('should return null on 401 when configured', async () => {
      const { api } = await import('../../client/src/lib/api');
      const { getQueryFn } = await import('../../client/src/lib/queryClient');

      const error = { response: { status: 401 } };
      vi.mocked(api.get).mockRejectedValue(error);

      const queryFn = getQueryFn({ on401: 'returnNull' });
      const result = await queryFn({
        queryKey: ['/api/protected'],
        meta: undefined,
        signal: new AbortController().signal,
      });

      expect(result).toBeNull();
    });

    it('should throw 401 errors when configured to throw', async () => {
      const { api } = await import('../../client/src/lib/api');
      const { getQueryFn } = await import('../../client/src/lib/queryClient');

      const error = { response: { status: 401 } };
      vi.mocked(api.get).mockRejectedValue(error);

      const queryFn = getQueryFn({ on401: 'throw' });

      await expect(
        queryFn({
          queryKey: ['/api/protected'],
          meta: undefined,
          signal: new AbortController().signal,
        })
      ).rejects.toEqual(error);
    });

    it('should throw non-401 errors even when returnNull configured', async () => {
      const { api } = await import('../../client/src/lib/api');
      const { getQueryFn } = await import('../../client/src/lib/queryClient');

      const error = { response: { status: 500 } };
      vi.mocked(api.get).mockRejectedValue(error);

      const queryFn = getQueryFn({ on401: 'returnNull' });

      await expect(
        queryFn({
          queryKey: ['/api/test'],
          meta: undefined,
          signal: new AbortController().signal,
        })
      ).rejects.toEqual(error);
    });
  });

  describe('queryClient configuration', () => {
    it('should export queryClient instance', async () => {
      const { queryClient } = await import('../../client/src/lib/queryClient');

      expect(queryClient).toBeDefined();
      expect(typeof queryClient.invalidateQueries).toBe('function');
      expect(typeof queryClient.setQueryData).toBe('function');
    });

    it('should have correct default options', async () => {
      const { queryClient } = await import('../../client/src/lib/queryClient');

      const defaultOptions = queryClient.getDefaultOptions();

      expect(defaultOptions.queries?.refetchInterval).toBe(false);
      expect(defaultOptions.queries?.refetchOnWindowFocus).toBe(false);
      expect(defaultOptions.queries?.staleTime).toBe(Infinity);
    });

    it('should have retry logic configured', async () => {
      const { queryClient } = await import('../../client/src/lib/queryClient');

      const defaultOptions = queryClient.getDefaultOptions();
      const retry = defaultOptions.queries?.retry;

      expect(typeof retry).toBe('function');

      if (typeof retry === 'function') {
        // Should not retry on 401
        expect(retry(0, { response: { status: 401 } })).toBe(false);

        // Should not retry on 403
        expect(retry(0, { response: { status: 403 } })).toBe(false);

        // Should not retry on 404
        expect(retry(0, { response: { status: 404 } })).toBe(false);

        // Should retry on 500 (first attempt)
        expect(retry(0, { response: { status: 500 } })).toBe(true);

        // Should retry on 500 (second attempt)
        expect(retry(1, { response: { status: 500 } })).toBe(true);

        // Should not retry on 500 after 2 failures
        expect(retry(2, { response: { status: 500 } })).toBe(false);
      }
    });

    it('should have mutations configured not to retry', async () => {
      const { queryClient } = await import('../../client/src/lib/queryClient');

      const defaultOptions = queryClient.getDefaultOptions();

      expect(defaultOptions.mutations?.retry).toBe(false);
    });
  });
});
