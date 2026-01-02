import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock the dataloader module
vi.mock('../../server/services/hydration/dataloader', () => ({
  createDataLoader: vi.fn(() => ({
    clearAll: vi.fn(),
    loadPost: vi.fn(),
    loadActor: vi.fn(),
  })),
  HydrationDataLoader: class {
    clearAll = vi.fn();
  },
}));

import {
  dataLoaderMiddleware,
  getRequestDataLoader,
} from '../../server/middleware/dataloader';
import { createDataLoader } from '../../server/services/hydration/dataloader';

describe('DataLoader Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: NextFunction;
  let finishHandlers: (() => void)[];

  beforeEach(() => {
    vi.clearAllMocks();
    finishHandlers = [];

    mockReq = {
      dataLoader: undefined,
    };

    mockRes = {
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') {
          finishHandlers.push(handler);
        }
        return mockRes as Response;
      }),
    };

    nextFn = vi.fn();
  });

  describe('dataLoaderMiddleware', () => {
    it('should create a DataLoader and attach it to the request', () => {
      dataLoaderMiddleware(
        mockReq as Request,
        mockRes as Response,
        nextFn
      );

      expect(createDataLoader).toHaveBeenCalledTimes(1);
      expect(mockReq.dataLoader).toBeDefined();
    });

    it('should call next() after attaching the DataLoader', () => {
      dataLoaderMiddleware(
        mockReq as Request,
        mockRes as Response,
        nextFn
      );

      expect(nextFn).toHaveBeenCalledTimes(1);
    });

    it('should register a finish handler on the response', () => {
      dataLoaderMiddleware(
        mockReq as Request,
        mockRes as Response,
        nextFn
      );

      expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function));
    });

    it('should clean up DataLoader on response finish', () => {
      dataLoaderMiddleware(
        mockReq as Request,
        mockRes as Response,
        nextFn
      );

      const dataLoader = mockReq.dataLoader;
      expect(dataLoader).toBeDefined();

      // Simulate response finish
      finishHandlers.forEach((handler) => handler());

      expect(dataLoader!.clearAll).toHaveBeenCalledTimes(1);
      expect(mockReq.dataLoader).toBeUndefined();
    });

    it('should handle finish when dataLoader is already undefined', () => {
      dataLoaderMiddleware(
        mockReq as Request,
        mockRes as Response,
        nextFn
      );

      // Manually clear the dataLoader before finish
      mockReq.dataLoader = undefined;

      // Simulate response finish - should not throw
      expect(() => {
        finishHandlers.forEach((handler) => handler());
      }).not.toThrow();
    });
  });

  describe('getRequestDataLoader', () => {
    it('should return existing DataLoader if present', () => {
      const existingLoader = {
        clearAll: vi.fn(),
        loadPost: vi.fn(),
      };
      mockReq.dataLoader = existingLoader as any;

      const result = getRequestDataLoader(mockReq as Request);

      expect(result).toBe(existingLoader);
      expect(createDataLoader).not.toHaveBeenCalled();
    });

    it('should create new DataLoader if not present', () => {
      mockReq.dataLoader = undefined;

      const result = getRequestDataLoader(mockReq as Request);

      expect(createDataLoader).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
      expect(mockReq.dataLoader).toBe(result);
    });

    it('should store created DataLoader on the request', () => {
      mockReq.dataLoader = undefined;

      getRequestDataLoader(mockReq as Request);

      expect(mockReq.dataLoader).toBeDefined();

      // Second call should return the same loader
      const secondResult = getRequestDataLoader(mockReq as Request);
      expect(secondResult).toBe(mockReq.dataLoader);
    });
  });
});
