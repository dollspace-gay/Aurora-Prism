import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Label } from '@shared/schema';

// Mock storage
vi.mock('../../server/storage', () => ({
  storage: {
    createLabel: vi.fn(),
    createLabelEvent: vi.fn(),
    getLabel: vi.fn(),
    deleteLabel: vi.fn(),
    getLabelsForSubject: vi.fn(),
    getLabelsForSubjects: vi.fn(),
    queryLabels: vi.fn(),
    createLabelDefinition: vi.fn(),
    getLabelDefinition: vi.fn(),
    getAllLabelDefinitions: vi.fn(),
    updateLabelDefinition: vi.fn(),
    getRecentLabelEvents: vi.fn(),
  },
}));

import { LabelService } from '../../server/services/label';
import { storage } from '../../server/storage';

// Helper to create mock labels
function createMockLabel(overrides: Partial<Label> = {}): Label {
  return {
    uri: 'at://did:plc:labeler/app.bsky.labeler.label/123',
    src: 'did:plc:labeler',
    subject: 'at://did:plc:user/app.bsky.feed.post/456',
    val: 'spam',
    neg: false,
    createdAt: new Date('2024-01-01'),
    indexedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('LabelService', () => {
  let labelService: LabelService;

  beforeEach(() => {
    vi.clearAllMocks();
    labelService = new LabelService();
  });

  describe('applyLabel', () => {
    it('should create a label with correct parameters', async () => {
      const mockLabel = createMockLabel();
      vi.mocked(storage.createLabel).mockResolvedValue(mockLabel);
      vi.mocked(storage.createLabelEvent).mockResolvedValue({
        id: 1,
        labelUri: mockLabel.uri,
        action: 'created',
        createdAt: new Date(),
      });

      const result = await labelService.applyLabel({
        src: 'did:plc:labeler',
        subject: 'at://did:plc:user/app.bsky.feed.post/456',
        val: 'spam',
      });

      expect(storage.createLabel).toHaveBeenCalledWith(
        expect.objectContaining({
          src: 'did:plc:labeler',
          subject: 'at://did:plc:user/app.bsky.feed.post/456',
          val: 'spam',
          neg: false,
        })
      );
      expect(storage.createLabelEvent).toHaveBeenCalled();
      expect(result).toEqual(mockLabel);
    });

    it('should emit labelCreated event', async () => {
      const mockLabel = createMockLabel();
      vi.mocked(storage.createLabel).mockResolvedValue(mockLabel);
      vi.mocked(storage.createLabelEvent).mockResolvedValue({
        id: 1,
        labelUri: mockLabel.uri,
        action: 'created',
        createdAt: new Date(),
      });

      const eventSpy = vi.fn();
      labelService.on('labelCreated', eventSpy);

      await labelService.applyLabel({
        src: 'did:plc:labeler',
        subject: 'at://did:plc:user/app.bsky.feed.post/456',
        val: 'spam',
      });

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          label: mockLabel,
        })
      );
    });

    it('should allow custom createdAt date', async () => {
      const customDate = new Date('2023-06-15');
      const mockLabel = createMockLabel({ createdAt: customDate });
      vi.mocked(storage.createLabel).mockResolvedValue(mockLabel);
      vi.mocked(storage.createLabelEvent).mockResolvedValue({
        id: 1,
        labelUri: mockLabel.uri,
        action: 'created',
        createdAt: new Date(),
      });

      await labelService.applyLabel({
        src: 'did:plc:labeler',
        subject: 'at://did:plc:user/app.bsky.feed.post/456',
        val: 'spam',
        createdAt: customDate,
      });

      expect(storage.createLabel).toHaveBeenCalledWith(
        expect.objectContaining({
          createdAt: customDate,
        })
      );
    });
  });

  describe('negateLabel', () => {
    it('should apply label with neg=true', async () => {
      const mockLabel = createMockLabel({ neg: true });
      vi.mocked(storage.createLabel).mockResolvedValue(mockLabel);
      vi.mocked(storage.createLabelEvent).mockResolvedValue({
        id: 1,
        labelUri: mockLabel.uri,
        action: 'created',
        createdAt: new Date(),
      });

      const result = await labelService.negateLabel({
        src: 'did:plc:labeler',
        subject: 'at://did:plc:user/app.bsky.feed.post/456',
        val: 'spam',
      });

      expect(storage.createLabel).toHaveBeenCalledWith(
        expect.objectContaining({
          neg: true,
        })
      );
      expect(result.neg).toBe(true);
    });
  });

  describe('removeLabel', () => {
    it('should delete label and emit event', async () => {
      const mockLabel = createMockLabel();
      vi.mocked(storage.getLabel).mockResolvedValue(mockLabel);
      vi.mocked(storage.createLabelEvent).mockResolvedValue({
        id: 1,
        labelUri: mockLabel.uri,
        action: 'deleted',
        createdAt: new Date(),
      });
      vi.mocked(storage.deleteLabel).mockResolvedValue(undefined);

      const eventSpy = vi.fn();
      labelService.on('labelRemoved', eventSpy);

      await labelService.removeLabel(mockLabel.uri);

      expect(storage.deleteLabel).toHaveBeenCalledWith(mockLabel.uri);
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          label: mockLabel,
        })
      );
    });

    it('should not emit event if label not found', async () => {
      vi.mocked(storage.getLabel).mockResolvedValue(undefined);
      vi.mocked(storage.createLabelEvent).mockResolvedValue({
        id: 1,
        labelUri: 'uri',
        action: 'deleted',
        createdAt: new Date(),
      });
      vi.mocked(storage.deleteLabel).mockResolvedValue(undefined);

      const eventSpy = vi.fn();
      labelService.on('labelRemoved', eventSpy);

      await labelService.removeLabel('nonexistent-uri');

      expect(eventSpy).not.toHaveBeenCalled();
    });
  });

  describe('getLabelsForSubject', () => {
    it('should return labels from storage', async () => {
      const mockLabels = [
        createMockLabel({ val: 'spam' }),
        createMockLabel({ val: 'nsfw' }),
      ];
      vi.mocked(storage.getLabelsForSubject).mockResolvedValue(mockLabels);

      const result = await labelService.getLabelsForSubject('subject-uri');

      expect(storage.getLabelsForSubject).toHaveBeenCalledWith('subject-uri');
      expect(result).toEqual(mockLabels);
    });
  });

  describe('getLabelsForSubjects', () => {
    it('should return map of labels grouped by subject', async () => {
      const subject1 = 'at://did:plc:user1/app.bsky.feed.post/1';
      const subject2 = 'at://did:plc:user2/app.bsky.feed.post/2';

      const mockLabels = [
        createMockLabel({ subject: subject1, val: 'spam' }),
        createMockLabel({ subject: subject1, val: 'nsfw' }),
        createMockLabel({ subject: subject2, val: 'spam' }),
      ];
      vi.mocked(storage.getLabelsForSubjects).mockResolvedValue(mockLabels);

      const result = await labelService.getLabelsForSubjects([
        subject1,
        subject2,
      ]);

      expect(result.get(subject1)?.length).toBe(2);
      expect(result.get(subject2)?.length).toBe(1);
    });

    it('should return empty map for no subjects', async () => {
      vi.mocked(storage.getLabelsForSubjects).mockResolvedValue([]);

      const result = await labelService.getLabelsForSubjects([]);

      expect(result.size).toBe(0);
    });
  });

  describe('queryLabels', () => {
    it('should pass query params to storage', async () => {
      const mockLabels = [createMockLabel()];
      vi.mocked(storage.queryLabels).mockResolvedValue(mockLabels);

      const params = {
        sources: ['did:plc:labeler'],
        values: ['spam'],
        limit: 10,
      };

      const result = await labelService.queryLabels(params);

      expect(storage.queryLabels).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockLabels);
    });
  });

  describe('getActiveLabelsForSubject', () => {
    it('should filter out negated labels', async () => {
      const subject = 'at://did:plc:user/app.bsky.feed.post/1';
      const mockLabels = [
        createMockLabel({
          subject,
          val: 'spam',
          neg: false,
          createdAt: new Date('2024-01-01'),
        }),
        createMockLabel({
          subject,
          val: 'spam',
          neg: true,
          createdAt: new Date('2024-01-02'),
        }),
        createMockLabel({
          subject,
          val: 'nsfw',
          neg: false,
          createdAt: new Date('2024-01-01'),
        }),
      ];
      vi.mocked(storage.getLabelsForSubject).mockResolvedValue(mockLabels);

      const result = await labelService.getActiveLabelsForSubject(subject);

      // 'spam' was negated, only 'nsfw' should remain
      expect(result.length).toBe(1);
      expect(result[0].val).toBe('nsfw');
    });

    it('should keep label if negation comes before application', async () => {
      const subject = 'at://did:plc:user/app.bsky.feed.post/1';
      const mockLabels = [
        createMockLabel({
          subject,
          val: 'spam',
          neg: true,
          createdAt: new Date('2024-01-01'),
        }),
        createMockLabel({
          subject,
          val: 'spam',
          neg: false,
          createdAt: new Date('2024-01-02'),
        }),
      ];
      vi.mocked(storage.getLabelsForSubject).mockResolvedValue(mockLabels);

      const result = await labelService.getActiveLabelsForSubject(subject);

      // Negation came first, then application, so label should be active
      expect(result.length).toBe(1);
      expect(result[0].val).toBe('spam');
      expect(result[0].neg).toBe(false);
    });
  });

  describe('getActiveLabelsForSubjects', () => {
    it('should filter negated labels for each subject', async () => {
      const subject1 = 'at://did:plc:user1/app.bsky.feed.post/1';
      const subject2 = 'at://did:plc:user2/app.bsky.feed.post/2';

      const mockLabels = [
        createMockLabel({
          subject: subject1,
          val: 'spam',
          neg: false,
          createdAt: new Date('2024-01-01'),
        }),
        createMockLabel({
          subject: subject1,
          val: 'spam',
          neg: true,
          createdAt: new Date('2024-01-02'),
        }),
        createMockLabel({
          subject: subject2,
          val: 'nsfw',
          neg: false,
          createdAt: new Date('2024-01-01'),
        }),
      ];
      vi.mocked(storage.getLabelsForSubjects).mockResolvedValue(mockLabels);

      const result = await labelService.getActiveLabelsForSubjects([
        subject1,
        subject2,
      ]);

      expect(result.get(subject1)?.length).toBe(0); // spam was negated
      expect(result.get(subject2)?.length).toBe(1); // nsfw is active
    });
  });

  describe('label definitions', () => {
    it('should create label definition', async () => {
      const mockDefinition = {
        id: 1,
        value: 'custom-label',
        description: 'A custom label',
        severity: 'warn' as const,
        localizedStrings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(storage.createLabelDefinition).mockResolvedValue(
        mockDefinition
      );

      const result = await labelService.createLabelDefinition({
        value: 'custom-label',
        description: 'A custom label',
      });

      expect(storage.createLabelDefinition).toHaveBeenCalledWith(
        expect.objectContaining({
          value: 'custom-label',
          description: 'A custom label',
          severity: 'warn',
        })
      );
      expect(result).toEqual(mockDefinition);
    });

    it('should get label definition', async () => {
      const mockDefinition = {
        id: 1,
        value: 'spam',
        description: 'Spam content',
        severity: 'alert' as const,
        localizedStrings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(storage.getLabelDefinition).mockResolvedValue(mockDefinition);

      const result = await labelService.getLabelDefinition('spam');

      expect(storage.getLabelDefinition).toHaveBeenCalledWith('spam');
      expect(result).toEqual(mockDefinition);
    });

    it('should get all label definitions', async () => {
      const mockDefinitions = [
        {
          id: 1,
          value: 'spam',
          description: '',
          severity: 'warn' as const,
          localizedStrings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          value: 'nsfw',
          description: '',
          severity: 'alert' as const,
          localizedStrings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      vi.mocked(storage.getAllLabelDefinitions).mockResolvedValue(
        mockDefinitions
      );

      const result = await labelService.getAllLabelDefinitions();

      expect(result).toEqual(mockDefinitions);
    });

    it('should update label definition', async () => {
      const mockDefinition = {
        id: 1,
        value: 'spam',
        description: 'Updated description',
        severity: 'alert' as const,
        localizedStrings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(storage.updateLabelDefinition).mockResolvedValue(
        mockDefinition
      );

      const result = await labelService.updateLabelDefinition('spam', {
        description: 'Updated description',
      });

      expect(storage.updateLabelDefinition).toHaveBeenCalledWith('spam', {
        description: 'Updated description',
      });
      expect(result).toEqual(mockDefinition);
    });
  });

  describe('getRecentLabelEvents', () => {
    it('should return recent events', async () => {
      const mockEvents = [
        { id: 1, labelUri: 'uri1', action: 'created', createdAt: new Date() },
        { id: 2, labelUri: 'uri2', action: 'deleted', createdAt: new Date() },
      ];
      vi.mocked(storage.getRecentLabelEvents).mockResolvedValue(mockEvents);

      const result = await labelService.getRecentLabelEvents(50);

      expect(storage.getRecentLabelEvents).toHaveBeenCalledWith(50, undefined);
      expect(result).toEqual(mockEvents);
    });

    it('should support since parameter', async () => {
      const since = new Date('2024-01-01');
      vi.mocked(storage.getRecentLabelEvents).mockResolvedValue([]);

      await labelService.getRecentLabelEvents(100, since);

      expect(storage.getRecentLabelEvents).toHaveBeenCalledWith(100, since);
    });
  });
});
