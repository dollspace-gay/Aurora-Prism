import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { handleError } from '../../server/services/xrpc/utils/error-handler';

describe('XRPC Error Handler', () => {
  let mockRes: any;

  beforeEach(() => {
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleError', () => {
    it('should handle Zod validation errors with 400 status', () => {
      const schema = z.object({ name: z.string() });
      let zodError: z.ZodError;

      try {
        schema.parse({ name: 123 });
      } catch (e) {
        zodError = e as z.ZodError;
      }

      handleError(mockRes, zodError!, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'InvalidRequest',
        message: expect.any(Array),
      });
    });

    it('should handle NotFound errors with 404 status', () => {
      const error = new Error('Resource NotFound');

      handleError(mockRes, error, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'NotFound',
        message: 'Resource NotFound',
      });
    });

    it('should handle fetch errors with 502 status', () => {
      const error = new Error('fetch failed');

      handleError(mockRes, error, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(502);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'UpstreamServiceUnavailable',
        message:
          'Upstream service is temporarily unavailable. Please try again later.',
      });
    });

    it('should handle network errors with 502 status', () => {
      const error = new Error('network connection failed');

      handleError(mockRes, error, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(502);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'UpstreamServiceUnavailable',
        message: expect.stringContaining('Upstream service'),
      });
    });

    it('should handle ECONNREFUSED errors with 502 status', () => {
      const error = new Error('ECONNREFUSED');

      handleError(mockRes, error, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(502);
    });

    it('should handle ETIMEDOUT errors with 502 status', () => {
      const error = new Error('ETIMEDOUT');

      handleError(mockRes, error, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(502);
    });

    it('should handle upstream errors with 502 status', () => {
      const error = new Error('upstream service failed');

      handleError(mockRes, error, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(502);
    });

    it('should handle unreachable errors with 502 status', () => {
      const error = new Error('Host unreachable');

      handleError(mockRes, error, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(502);
    });

    it('should handle generic errors with 500 status', () => {
      const error = new Error('Something went wrong');

      handleError(mockRes, error, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'InternalServerError',
        message: 'An internal error occurred',
      });
    });

    it('should handle non-Error objects with 500 status', () => {
      const error = { code: 'UNKNOWN', detail: 'Something' };

      handleError(mockRes, error, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'InternalServerError',
        message: 'An internal error occurred',
      });
    });

    it('should handle null/undefined errors with 500 status', () => {
      handleError(mockRes, null, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should handle string errors with 500 status', () => {
      handleError(mockRes, 'Something went wrong', 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should log error with context', () => {
      const error = new Error('Test error');

      handleError(mockRes, error, 'myEndpoint');

      expect(console.error).toHaveBeenCalledWith(
        '[XRPC] Error in %s:',
        'myEndpoint',
        error
      );
    });

    it('should prioritize Zod errors over other error types', () => {
      const schema = z.object({ id: z.number() });
      let zodError: z.ZodError;

      try {
        schema.parse({ id: 'not-a-number' });
      } catch (e) {
        zodError = e as z.ZodError;
      }

      handleError(mockRes, zodError!, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should handle complex Zod validation errors', () => {
      const schema = z.object({
        name: z.string().min(3),
        age: z.number().positive(),
        email: z.string().email(),
      });

      let zodError: z.ZodError;

      try {
        schema.parse({ name: 'ab', age: -1, email: 'invalid' });
      } catch (e) {
        zodError = e as z.ZodError;
      }

      handleError(mockRes, zodError!, 'testEndpoint');

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'InvalidRequest',
        message: expect.arrayContaining([
          expect.objectContaining({ path: ['name'] }),
          expect.objectContaining({ path: ['age'] }),
          expect.objectContaining({ path: ['email'] }),
        ]),
      });
    });
  });
});
