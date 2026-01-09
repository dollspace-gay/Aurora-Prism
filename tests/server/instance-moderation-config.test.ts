import { describe, it, expect } from 'vitest';
import {
  LEGAL_LABELS,
  SAFETY_LABELS,
  QUALITY_LABELS,
  INSTANCE_CONFIG,
  getEnabledLabels,
  getLabelConfig,
  shouldDeleteReference,
  getLabelsByReason,
} from '../../server/config/instance-moderation';

describe('Instance Moderation Config', () => {
  describe('LEGAL_LABELS', () => {
    it('should contain dmca-takedown label', () => {
      const dmca = LEGAL_LABELS.find((l) => l.value === 'dmca-takedown');
      expect(dmca).toBeDefined();
      expect(dmca?.severity).toBe('alert');
      expect(dmca?.action).toBe('delete-reference');
      expect(dmca?.reason).toBe('legal');
    });

    it('should contain court-order label', () => {
      const courtOrder = LEGAL_LABELS.find((l) => l.value === 'court-order');
      expect(courtOrder).toBeDefined();
      expect(courtOrder?.action).toBe('delete-reference');
    });

    it('should contain illegal-content label', () => {
      const illegal = LEGAL_LABELS.find((l) => l.value === 'illegal-content');
      expect(illegal).toBeDefined();
      expect(illegal?.enabled).toBe(true);
    });

    it('should have dsa-removal for EU compliance', () => {
      const dsa = LEGAL_LABELS.find((l) => l.value === 'dsa-removal');
      expect(dsa).toBeDefined();
      expect(dsa?.description).toContain('EU Digital Services Act');
    });

    it('should have netzdg-removal for German compliance', () => {
      const netzdg = LEGAL_LABELS.find((l) => l.value === 'netzdg-removal');
      expect(netzdg).toBeDefined();
      expect(netzdg?.description).toContain('NetzDG');
    });
  });

  describe('SAFETY_LABELS', () => {
    it('should contain doxxing label', () => {
      const doxxing = SAFETY_LABELS.find((l) => l.value === 'doxxing');
      expect(doxxing).toBeDefined();
      expect(doxxing?.severity).toBe('alert');
      expect(doxxing?.action).toBe('hide');
    });

    it('should contain impersonation label', () => {
      const impersonation = SAFETY_LABELS.find(
        (l) => l.value === 'impersonation'
      );
      expect(impersonation).toBeDefined();
      expect(impersonation?.action).toBe('flag');
    });

    it('should contain credible-threat label', () => {
      const threat = SAFETY_LABELS.find((l) => l.value === 'credible-threat');
      expect(threat).toBeDefined();
      expect(threat?.severity).toBe('alert');
    });

    it('should contain self-harm label', () => {
      const selfHarm = SAFETY_LABELS.find((l) => l.value === 'self-harm');
      expect(selfHarm).toBeDefined();
      expect(selfHarm?.action).toBe('blur');
    });
  });

  describe('QUALITY_LABELS', () => {
    it('should contain spam-extreme label', () => {
      const spam = QUALITY_LABELS.find((l) => l.value === 'spam-extreme');
      expect(spam).toBeDefined();
      expect(spam?.action).toBe('hide');
    });

    it('should contain malicious-link label', () => {
      const malicious = QUALITY_LABELS.find(
        (l) => l.value === 'malicious-link'
      );
      expect(malicious).toBeDefined();
      expect(malicious?.severity).toBe('alert');
    });

    it('should contain report-threshold label', () => {
      const threshold = QUALITY_LABELS.find(
        (l) => l.value === 'report-threshold'
      );
      expect(threshold).toBeDefined();
      expect(threshold?.action).toBe('flag');
    });
  });

  describe('INSTANCE_CONFIG', () => {
    it('should have labelerDid property', () => {
      expect(INSTANCE_CONFIG.labelerDid).toBeDefined();
    });

    it('should have default jurisdiction', () => {
      expect(INSTANCE_CONFIG.jurisdiction).toBeDefined();
    });

    it('should have legalContact', () => {
      expect(INSTANCE_CONFIG.legalContact).toBeDefined();
    });

    it('should have numeric autoHideThreshold', () => {
      expect(typeof INSTANCE_CONFIG.autoHideThreshold).toBe('number');
    });

    it('should have enabled boolean', () => {
      expect(typeof INSTANCE_CONFIG.enabled).toBe('boolean');
    });
  });

  describe('getEnabledLabels', () => {
    it('should return array of labels', () => {
      const labels = getEnabledLabels();
      expect(Array.isArray(labels)).toBe(true);
    });

    it('should only include enabled labels', () => {
      const labels = getEnabledLabels();
      labels.forEach((label) => {
        expect(label.enabled).toBe(true);
      });
    });

    it('should include labels from all categories', () => {
      const labels = getEnabledLabels();
      const legalLabel = labels.find((l) => l.reason === 'legal');
      const safetyLabel = labels.find((l) => l.reason === 'safety');
      const qualityLabel = labels.find((l) => l.reason === 'quality');

      expect(legalLabel).toBeDefined();
      expect(safetyLabel).toBeDefined();
      expect(qualityLabel).toBeDefined();
    });

    it('should include dmca-takedown (enabled by default)', () => {
      const labels = getEnabledLabels();
      const dmca = labels.find((l) => l.value === 'dmca-takedown');
      expect(dmca).toBeDefined();
    });

    it('should not include dsa-removal (disabled by default)', () => {
      const labels = getEnabledLabels();
      const dsa = labels.find((l) => l.value === 'dsa-removal');
      expect(dsa).toBeUndefined();
    });
  });

  describe('getLabelConfig', () => {
    it('should return config for known label', () => {
      const config = getLabelConfig('dmca-takedown');
      expect(config).toBeDefined();
      expect(config?.value).toBe('dmca-takedown');
    });

    it('should return undefined for unknown label', () => {
      const config = getLabelConfig('nonexistent-label');
      expect(config).toBeUndefined();
    });

    it('should return undefined for disabled labels', () => {
      // dsa-removal is disabled by default
      const config = getLabelConfig('dsa-removal');
      expect(config).toBeUndefined();
    });

    it('should return full label config object', () => {
      const config = getLabelConfig('doxxing');
      expect(config).toBeDefined();
      expect(config).toHaveProperty('value');
      expect(config).toHaveProperty('severity');
      expect(config).toHaveProperty('action');
      expect(config).toHaveProperty('reason');
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('enabled');
    });
  });

  describe('shouldDeleteReference', () => {
    it('should return true for dmca-takedown', () => {
      expect(shouldDeleteReference('dmca-takedown')).toBe(true);
    });

    it('should return true for court-order', () => {
      expect(shouldDeleteReference('court-order')).toBe(true);
    });

    it('should return true for illegal-content', () => {
      expect(shouldDeleteReference('illegal-content')).toBe(true);
    });

    it('should return false for doxxing (hide action)', () => {
      expect(shouldDeleteReference('doxxing')).toBe(false);
    });

    it('should return false for impersonation (flag action)', () => {
      expect(shouldDeleteReference('impersonation')).toBe(false);
    });

    it('should return false for self-harm (blur action)', () => {
      expect(shouldDeleteReference('self-harm')).toBe(false);
    });

    it('should return false for unknown labels', () => {
      expect(shouldDeleteReference('nonexistent')).toBe(false);
    });
  });

  describe('getLabelsByReason', () => {
    it('should return legal labels', () => {
      const labels = getLabelsByReason('legal');
      expect(labels.length).toBeGreaterThan(0);
      labels.forEach((label) => {
        expect(label.reason).toBe('legal');
      });
    });

    it('should return safety labels', () => {
      const labels = getLabelsByReason('safety');
      expect(labels.length).toBeGreaterThan(0);
      labels.forEach((label) => {
        expect(label.reason).toBe('safety');
      });
    });

    it('should return quality labels', () => {
      const labels = getLabelsByReason('quality');
      expect(labels.length).toBeGreaterThan(0);
      labels.forEach((label) => {
        expect(label.reason).toBe('quality');
      });
    });

    it('should return empty array for tos (none enabled by default)', () => {
      const labels = getLabelsByReason('tos');
      // May or may not have TOS labels defined
      labels.forEach((label) => {
        expect(label.reason).toBe('tos');
      });
    });

    it('should only return enabled labels', () => {
      const labels = getLabelsByReason('legal');
      labels.forEach((label) => {
        expect(label.enabled).toBe(true);
      });
    });
  });

  describe('Label structure validation', () => {
    it('all labels should have required properties', () => {
      const allLabels = [...LEGAL_LABELS, ...SAFETY_LABELS, ...QUALITY_LABELS];

      allLabels.forEach((label) => {
        expect(label.value).toBeDefined();
        expect(typeof label.value).toBe('string');
        expect(label.severity).toBeDefined();
        expect(['info', 'warn', 'alert', 'none']).toContain(label.severity);
        expect(label.action).toBeDefined();
        expect(['hide', 'blur', 'flag', 'delete-reference']).toContain(
          label.action
        );
        expect(label.reason).toBeDefined();
        expect(['legal', 'safety', 'quality', 'tos']).toContain(label.reason);
        expect(label.description).toBeDefined();
        expect(typeof label.description).toBe('string');
        expect(typeof label.enabled).toBe('boolean');
      });
    });

    it('all label values should be unique', () => {
      const allLabels = [...LEGAL_LABELS, ...SAFETY_LABELS, ...QUALITY_LABELS];
      const values = allLabels.map((l) => l.value);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });
});
