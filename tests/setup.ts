/* global window, ResizeObserver, IntersectionObserver */
import { afterEach, vi } from 'vitest';

// Set environment variables needed by modules that check them at import time
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'test-secret-key-for-testing-1234567890abcdef';
}

// Cleanup after each test
afterEach(() => {
  vi.clearAllMocks();
});

// Only setup browser mocks if window exists (jsdom environment)
if (typeof window !== 'undefined') {
  // Mock window.matchMedia for component tests
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Mock ResizeObserver
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })) as unknown as typeof ResizeObserver;
}

// Mock IntersectionObserver
if (typeof global.IntersectionObserver === 'undefined') {
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    root: null,
    rootMargin: '',
    thresholds: [],
  })) as unknown as typeof IntersectionObserver;
}
