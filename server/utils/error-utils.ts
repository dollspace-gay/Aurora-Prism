/**
 * Error utility functions for type-safe error handling
 */

/**
 * Safely extract error message from an unknown error type
 * Use this in catch blocks instead of `catch (error: any)`
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

/**
 * Check if an error has a specific status code (common in HTTP errors)
 */
export function hasErrorStatus(
  error: unknown,
  status: number
): error is { status: number } {
  return (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status: unknown }).status === status
  );
}

/**
 * Check if error is an HTTP-like error with status property
 */
export function isHttpError(
  error: unknown
): error is { status: number; message?: string } {
  return (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  );
}

/**
 * Get error status code if available
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (isHttpError(error)) {
    return error.status;
  }
  return undefined;
}

/**
 * Check if an error has a specific error code (common in Node.js errors)
 */
export function hasErrorCode(
  error: unknown,
  code: string
): error is { code: string } {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}

/**
 * Get error code if available
 */
export function getErrorCode(error: unknown): string | undefined {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}
