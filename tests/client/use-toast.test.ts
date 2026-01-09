import { describe, it, expect } from 'vitest';
import { reducer, toast } from '../../client/src/hooks/use-toast';

describe('use-toast', () => {
  describe('toast function', () => {
    it('should create a toast and return id, dismiss, and update functions', () => {
      const result = toast({ title: 'Test Toast' });

      expect(result.id).toBeDefined();
      expect(typeof result.dismiss).toBe('function');
      expect(typeof result.update).toBe('function');
    });

    it('should generate unique ids for each toast', () => {
      const toast1 = toast({ title: 'Toast 1' });
      const toast2 = toast({ title: 'Toast 2' });
      const toast3 = toast({ title: 'Toast 3' });

      expect(toast1.id).not.toBe(toast2.id);
      expect(toast2.id).not.toBe(toast3.id);
    });

    it('should allow updating a toast', () => {
      const { update, id } = toast({ title: 'Original' });

      // Update should not throw
      expect(() => update({ id, title: 'Updated' } as any)).not.toThrow();
    });

    it('should allow dismissing a toast', () => {
      const { dismiss } = toast({ title: 'Test' });

      // Dismiss should not throw
      expect(() => dismiss()).not.toThrow();
    });
  });

  describe('reducer', () => {
    describe('ADD_TOAST', () => {
      it('should add toast to empty state', () => {
        const state = { toasts: [] };
        const toast = { id: '1', title: 'Test', open: true };

        const newState = reducer(state, {
          type: 'ADD_TOAST',
          toast: toast as any,
        });

        expect(newState.toasts).toHaveLength(1);
        expect(newState.toasts[0]).toEqual(toast);
      });

      it('should prepend toast to existing toasts (limited by TOAST_LIMIT)', () => {
        const existingToast = { id: '1', title: 'Existing', open: true };
        const state = { toasts: [existingToast as any] };
        const newToast = { id: '2', title: 'New', open: true };

        const newState = reducer(state, {
          type: 'ADD_TOAST',
          toast: newToast as any,
        });

        // TOAST_LIMIT is 1, so new toast replaces old one
        expect(newState.toasts).toHaveLength(1);
        expect(newState.toasts[0].id).toBe('2');
      });

      it('should limit toasts to TOAST_LIMIT (1)', () => {
        const existingToast = { id: '1', title: 'Existing', open: true };
        const state = { toasts: [existingToast as any] };
        const newToast = { id: '2', title: 'New', open: true };

        const newState = reducer(state, {
          type: 'ADD_TOAST',
          toast: newToast as any,
        });

        // TOAST_LIMIT is 1, so only the newest toast should remain
        expect(newState.toasts).toHaveLength(1);
        expect(newState.toasts[0].id).toBe('2');
      });
    });

    describe('UPDATE_TOAST', () => {
      it('should update matching toast', () => {
        const toast = {
          id: '1',
          title: 'Original',
          description: 'Desc',
          open: true,
        };
        const state = { toasts: [toast as any] };

        const newState = reducer(state, {
          type: 'UPDATE_TOAST',
          toast: { id: '1', title: 'Updated' },
        });

        expect(newState.toasts[0].title).toBe('Updated');
        expect(newState.toasts[0].description).toBe('Desc'); // Preserved
      });

      it('should not modify non-matching toasts', () => {
        const toast1 = { id: '1', title: 'Toast 1', open: true };
        const toast2 = { id: '2', title: 'Toast 2', open: true };
        const state = { toasts: [toast1 as any, toast2 as any] };

        const newState = reducer(state, {
          type: 'UPDATE_TOAST',
          toast: { id: '1', title: 'Updated 1' },
        });

        expect(newState.toasts[0].title).toBe('Updated 1');
        expect(newState.toasts[1].title).toBe('Toast 2'); // Unchanged
      });

      it('should handle updating non-existent toast', () => {
        const toast = { id: '1', title: 'Toast', open: true };
        const state = { toasts: [toast as any] };

        const newState = reducer(state, {
          type: 'UPDATE_TOAST',
          toast: { id: 'nonexistent', title: 'Updated' },
        });

        expect(newState.toasts).toHaveLength(1);
        expect(newState.toasts[0].title).toBe('Toast'); // Unchanged
      });
    });

    describe('DISMISS_TOAST', () => {
      it('should set open to false for specific toast', () => {
        const toast = { id: '1', title: 'Toast', open: true };
        const state = { toasts: [toast as any] };

        const newState = reducer(state, {
          type: 'DISMISS_TOAST',
          toastId: '1',
        });

        expect(newState.toasts[0].open).toBe(false);
      });

      it('should dismiss all toasts when no toastId provided', () => {
        const toast1 = { id: '1', title: 'Toast 1', open: true };
        const toast2 = { id: '2', title: 'Toast 2', open: true };
        const state = { toasts: [toast1 as any, toast2 as any] };

        const newState = reducer(state, {
          type: 'DISMISS_TOAST',
          toastId: undefined,
        });

        expect(newState.toasts[0].open).toBe(false);
        expect(newState.toasts[1].open).toBe(false);
      });

      it('should not affect other toasts when dismissing specific one', () => {
        const toast1 = { id: '1', title: 'Toast 1', open: true };
        const toast2 = { id: '2', title: 'Toast 2', open: true };
        const state = { toasts: [toast1 as any, toast2 as any] };

        const newState = reducer(state, {
          type: 'DISMISS_TOAST',
          toastId: '1',
        });

        expect(newState.toasts[0].open).toBe(false);
        expect(newState.toasts[1].open).toBe(true); // Not affected
      });
    });

    describe('REMOVE_TOAST', () => {
      it('should remove specific toast', () => {
        const toast1 = { id: '1', title: 'Toast 1', open: true };
        const toast2 = { id: '2', title: 'Toast 2', open: true };
        const state = { toasts: [toast1 as any, toast2 as any] };

        const newState = reducer(state, {
          type: 'REMOVE_TOAST',
          toastId: '1',
        });

        expect(newState.toasts).toHaveLength(1);
        expect(newState.toasts[0].id).toBe('2');
      });

      it('should remove all toasts when no toastId provided', () => {
        const toast1 = { id: '1', title: 'Toast 1', open: true };
        const toast2 = { id: '2', title: 'Toast 2', open: true };
        const state = { toasts: [toast1 as any, toast2 as any] };

        const newState = reducer(state, {
          type: 'REMOVE_TOAST',
          toastId: undefined,
        });

        expect(newState.toasts).toHaveLength(0);
      });

      it('should handle removing non-existent toast', () => {
        const toast = { id: '1', title: 'Toast', open: true };
        const state = { toasts: [toast as any] };

        const newState = reducer(state, {
          type: 'REMOVE_TOAST',
          toastId: 'nonexistent',
        });

        expect(newState.toasts).toHaveLength(1);
      });
    });

    describe('state immutability', () => {
      it('should not mutate original state on ADD_TOAST', () => {
        const originalState = { toasts: [] };
        const toast = { id: '1', title: 'Test', open: true };

        reducer(originalState, { type: 'ADD_TOAST', toast: toast as any });

        expect(originalState.toasts).toHaveLength(0);
      });

      it('should not mutate original state on UPDATE_TOAST', () => {
        const originalToast = { id: '1', title: 'Original', open: true };
        const originalState = { toasts: [originalToast as any] };

        reducer(originalState, {
          type: 'UPDATE_TOAST',
          toast: { id: '1', title: 'Updated' },
        });

        expect(originalState.toasts[0].title).toBe('Original');
      });

      it('should return new state object', () => {
        const state = { toasts: [] };
        const toast = { id: '1', title: 'Test', open: true };

        const newState = reducer(state, {
          type: 'ADD_TOAST',
          toast: toast as any,
        });

        expect(newState).not.toBe(state);
      });
    });
  });
});
