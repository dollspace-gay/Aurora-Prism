import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We need to mock the module before importing
const originalEnv = process.env;

describe('EncryptionService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.SESSION_SECRET = 'test-secret-key-for-encryption-testing-32chars!';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('encrypt', () => {
    it('should encrypt plaintext and return formatted string', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const plaintext = 'Hello, World!';
      const encrypted = await encryptionService.encrypt(plaintext);

      // Should have format: salt:iv:authTag:encryptedData
      const parts = encrypted.split(':');
      expect(parts.length).toBe(4);

      // All parts should be hex strings
      parts.forEach((part) => {
        expect(part).toMatch(/^[0-9a-f]+$/i);
      });

      // Salt should be 32 bytes (64 hex chars)
      expect(parts[0].length).toBe(64);

      // IV should be 12 bytes (24 hex chars)
      expect(parts[1].length).toBe(24);

      // Auth tag should be 16 bytes (32 hex chars)
      expect(parts[2].length).toBe(32);
    });

    it('should produce different ciphertext each time (random IV)', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const plaintext = 'Same text';
      const encrypted1 = await encryptionService.encrypt(plaintext);
      const encrypted2 = await encryptionService.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should throw error if SESSION_SECRET is not set', async () => {
      delete process.env.SESSION_SECRET;

      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      await expect(encryptionService.encrypt('test')).rejects.toThrow(
        'SESSION_SECRET not set - cannot encrypt data'
      );
    });

    it('should handle empty string', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const encrypted = await encryptionService.encrypt('');
      expect(encrypted).toBeDefined();
      expect(encrypted.split(':').length).toBe(4);
    });

    it('should handle unicode characters', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const plaintext = 'Hello 世界 🌍 مرحبا';
      const encrypted = await encryptionService.encrypt(plaintext);
      const decrypted = await encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const plaintext = 'x'.repeat(10000);
      const encrypted = await encryptionService.encrypt(plaintext);
      const decrypted = await encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('decrypt', () => {
    it('should decrypt encrypted data correctly', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const plaintext = 'Secret message';
      const encrypted = await encryptionService.encrypt(plaintext);
      const decrypted = await encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw error if SESSION_SECRET is not set', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const encrypted = await encryptionService.encrypt('test');

      delete process.env.SESSION_SECRET;
      vi.resetModules();

      const { encryptionService: freshService } = await import(
        '../../server/services/encryption'
      );

      await expect(freshService.decrypt(encrypted)).rejects.toThrow(
        'SESSION_SECRET not set - cannot decrypt data'
      );
    });

    it('should throw error for invalid format (wrong number of parts)', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      await expect(encryptionService.decrypt('abc:def')).rejects.toThrow(
        'Failed to decrypt data'
      );

      await expect(
        encryptionService.decrypt('abc:def:ghi:jkl:extra')
      ).rejects.toThrow('Failed to decrypt data');
    });

    it('should throw error for tampered ciphertext', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const encrypted = await encryptionService.encrypt('test');
      const parts = encrypted.split(':');

      // Tamper with the encrypted data
      parts[3] = parts[3].replace(/[a-f]/gi, (c) =>
        c === 'a' ? 'b' : 'a'
      );
      const tampered = parts.join(':');

      await expect(encryptionService.decrypt(tampered)).rejects.toThrow(
        'Failed to decrypt data'
      );
    });

    it('should throw error for tampered auth tag', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const encrypted = await encryptionService.encrypt('test');
      const parts = encrypted.split(':');

      // Tamper with the auth tag
      parts[2] = '0'.repeat(32);
      const tampered = parts.join(':');

      await expect(encryptionService.decrypt(tampered)).rejects.toThrow(
        'Failed to decrypt data'
      );
    });

    it('should throw error for invalid auth tag length', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const encrypted = await encryptionService.encrypt('test');
      const parts = encrypted.split(':');

      // Invalid auth tag length (should be 32 hex chars = 16 bytes)
      parts[2] = 'abcd'; // Too short
      const tampered = parts.join(':');

      await expect(encryptionService.decrypt(tampered)).rejects.toThrow(
        'Failed to decrypt data'
      );
    });

    it('should throw error with wrong session secret', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const encrypted = await encryptionService.encrypt('test');

      // Change the secret
      process.env.SESSION_SECRET = 'different-secret-key-for-testing!!!';
      vi.resetModules();

      const { encryptionService: freshService } = await import(
        '../../server/services/encryption'
      );

      await expect(freshService.decrypt(encrypted)).rejects.toThrow(
        'Failed to decrypt data'
      );
    });
  });

  describe('isEncrypted', () => {
    it('should return true for properly encrypted data', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const encrypted = await encryptionService.encrypt('test');
      expect(encryptionService.isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plaintext', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      expect(encryptionService.isEncrypted('plain text')).toBe(false);
      expect(encryptionService.isEncrypted('not:encrypted')).toBe(false);
    });

    it('should return false for wrong format', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      expect(encryptionService.isEncrypted('a:b:c')).toBe(false); // Only 3 parts
      expect(encryptionService.isEncrypted('a:b:c:d:e')).toBe(false); // 5 parts
    });

    it('should return false for non-hex parts', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      expect(encryptionService.isEncrypted('abcd:1234:xyz!:5678')).toBe(false);
      expect(encryptionService.isEncrypted('ghij:1234:abcd:5678')).toBe(false);
    });

    it('should return true for valid hex format', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      expect(encryptionService.isEncrypted('abcd:1234:abcd:5678')).toBe(true);
      expect(encryptionService.isEncrypted('ABCD:1234:abcd:5678')).toBe(true);
    });
  });

  describe('round-trip encryption', () => {
    it('should encrypt and decrypt various data types', async () => {
      const { encryptionService } = await import(
        '../../server/services/encryption'
      );

      const testCases = [
        'Simple string',
        '',
        '   spaces   ',
        'Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?',
        'Unicode: 你好世界 🎉 مرحبا',
        JSON.stringify({ key: 'value', nested: { array: [1, 2, 3] } }),
        'Line1\nLine2\rLine3\r\nLine4',
        '\t\ttabs\t\t',
        'null\0byte',
      ];

      for (const testCase of testCases) {
        const encrypted = await encryptionService.encrypt(testCase);
        const decrypted = await encryptionService.decrypt(encrypted);
        expect(decrypted).toBe(testCase);
      }
    });
  });
});
