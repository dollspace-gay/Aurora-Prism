import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the api module
vi.mock('../../client/src/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { getQueryFn, queryClient } from '../../client/src/lib/queryClient';
import { api } from '../../client/src/lib/api';

describe('queryClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getQueryFn', () => {
    it('should create a query function that fetches data', async () => {
      const mockData = { id: 1, name: 'Test' };
      vi.mocked(api.get).mockResolvedValueOnce(mockData);

      const queryFn = getQueryFn();
      const result = await queryFn({ queryKey: ['/api', 'users', '1'] } as any);

      expect(api.get).toHaveBeenCalledWith('/api/users/1');
      expect(result).toEqual(mockData);
    });

    it('should join query key parts with slashes', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({});

      const queryFn = getQueryFn();
      await queryFn({ queryKey: ['api', 'posts', 'latest'] } as any);

      expect(api.get).toHaveBeenCalledWith('api/posts/latest');
    });

    it('should return null on 401 when on401 is returnNull', async () => {
      const error = { response: { status: 401 } };
      vi.mocked(api.get).mockRejectedValueOnce(error);

      const queryFn = getQueryFn({ on401: 'returnNull' });
      const result = await queryFn({ queryKey: ['/api/protected'] } as any);

      expect(result).toBeNull();
    });

    it('should throw on 401 when on401 is throw', async () => {
      const error = { response: { status: 401 } };
      vi.mocked(api.get).mockRejectedValueOnce(error);

      const queryFn = getQueryFn({ on401: 'throw' });

      await expect(
        queryFn({ queryKey: ['/api/protected'] } as any)
      ).rejects.toEqual(error);
    });

    it('should throw on other errors regardless of on401 setting', async () => {
      const error = { response: { status: 500 } };
      vi.mocked(api.get).mockRejectedValueOnce(error);

      const queryFn = getQueryFn({ on401: 'returnNull' });

      await expect(queryFn({ queryKey: ['/api/test'] } as any)).rejects.toEqual(
        error
      );
    });
  });

  describe('queryClient configuration', () => {
    it('should have correct default options', () => {
      const defaultOptions = queryClient.getDefaultOptions();

      expect(defaultOptions.queries?.refetchInterval).toBe(false);
      expect(defaultOptions.queries?.refetchOnWindowFocus).toBe(false);
      expect(defaultOptions.queries?.staleTime).toBe(Infinity);
    });

    it('should have retry function that returns false for 401/403/404', () => {
      const retryFn = queryClient.getDefaultOptions().queries
        ?.retry as Function;

      // 401 should not retry
      expect(retryFn(1, { response: { status: 401 } })).toBe(false);

      // 403 should not retry
      expect(retryFn(1, { response: { status: 403 } })).toBe(false);

      // 404 should not retry
      expect(retryFn(1, { response: { status: 404 } })).toBe(false);

      // Other errors should retry up to 2 times
      expect(retryFn(0, { response: { status: 500 } })).toBe(true);
      expect(retryFn(1, { response: { status: 500 } })).toBe(true);
      expect(retryFn(2, { response: { status: 500 } })).toBe(false);
    });

    it('should have mutations configured to not retry', () => {
      const defaultOptions = queryClient.getDefaultOptions();

      expect(defaultOptions.mutations?.retry).toBe(false);
    });
  });
});
