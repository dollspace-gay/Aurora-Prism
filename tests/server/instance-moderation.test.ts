import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../server/config/instance-moderation', () => ({
  INSTANCE_CONFIG: {
    enabled: true,
    labelerDid: 'did:plc:test-labeler',
    jurisdiction: 'US',
    legalContact: 'legal@test.com',
    autoHideThreshold: 10,
  },
  getEnabledLabels: vi.fn().mockReturnValue([
    {
      value: 'spam',
      severity: 'warn',
      reason: 'quality',
      description: 'Spam',
    },
  ]),
  getLabelConfig: vi.fn().mockReturnValue({
    value: 'spam',
    severity: 'warn',
    action: 'hide',
    reason: 'quality',
    description: 'Spam',
    enabled: true,
  }),
  shouldDeleteReference: vi.fn().mockReturnValue(false),
}));

vi.mock('../../server/services/label', () => ({
  labelService: {
    applyLabel: vi.fn().mockResolvedValue({ uri: 'at://label' }),
    queryLabels: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../server/storage', () => ({
  storage: {
    deletePost: vi.fn().mockResolvedValue(undefined),
  },
}));

import { instanceModerationService } from '../../server/services/instance-moderation';

describe('InstanceModerationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPublicPolicy', () => {
    it('should return public policy information', () => {
      const policy = instanceModerationService.getPublicPolicy();

      expect(policy).toBeDefined();
      expect(policy.enabled).toBe(true);
      expect(policy.jurisdiction).toBe('US');
      expect(policy.legalContact).toBe('legal@test.com');
      expect(policy.labelerDid).toBe('did:plc:test-labeler');
      expect(policy.labels).toBeDefined();
      expect(Array.isArray(policy.labels)).toBe(true);
    });

    it('should include auto moderation settings', () => {
      const policy = instanceModerationService.getPublicPolicy();

      expect(policy.autoModeration).toBeDefined();
      expect(policy.autoModeration.enabled).toBe(true);
      expect(policy.autoModeration.reportThreshold).toBe(10);
    });
  });

  describe('checkAutoModeration', () => {
    it('should return empty array for safe content', async () => {
      const result = await instanceModerationService.checkAutoModeration({
        text: 'This is a normal post',
        authorDid: 'did:plc:author',
      });

      expect(result).toEqual([]);
    });

    it('should detect malicious links', async () => {
      const result = await instanceModerationService.checkAutoModeration({
        text: 'Check out this link: phishing-site.com',
        authorDid: 'did:plc:author',
      });

      expect(result).toContain('malicious-link');
    });

    it('should handle undefined text', async () => {
      const result = await instanceModerationService.checkAutoModeration({
        authorDid: 'did:plc:author',
      });

      expect(result).toEqual([]);
    });
  });

  describe('getStatistics', () => {
    it('should return statistics object', async () => {
      const stats = await instanceModerationService.getStatistics();

      expect(stats).toBeDefined();
      expect(stats.totalLabelsApplied).toBeDefined();
      expect(stats.labelsByType).toBeDefined();
      expect(stats.takedownsLast30Days).toBeDefined();
      expect(stats.averageResponseTime).toBeDefined();
    });
  });

  describe('applyInstanceLabel', () => {
    it('should apply label for known label value', async () => {
      const { labelService } = await import('../../server/services/label');

      await instanceModerationService.applyInstanceLabel({
        subject: 'at://test-subject',
        labelValue: 'spam',
        reason: 'Test reason',
      });

      expect(labelService.applyLabel).toHaveBeenCalled();
    });
  });
});
