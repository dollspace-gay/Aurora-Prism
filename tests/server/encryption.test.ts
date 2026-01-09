import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encryptionService } from '../../server/services/encryption';

describe('encryptionService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SESSION_SECRET = 'test-secret-key-for-encryption-testing-12345';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('encrypt', () => {
    it('should encrypt plaintext successfully', async () => {
      const plaintext = 'sensitive data';
      const encrypted = await encryptionService.encrypt(plaintext);

      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.split(':').length).toBe(4);
    });

    it('should produce different ciphertext for same plaintext', async () => {
      const plaintext = 'same text';
      const encrypted1 = await encryptionService.encrypt(plaintext);
      const encrypted2 = await encryptionService.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should throw if SESSION_SECRET is not set', async () => {
      delete process.env.SESSION_SECRET;

      await expect(encryptionService.encrypt('test')).rejects.toThrow(
        'SESSION_SECRET not set'
      );
    });
  });

  describe('decrypt', () => {
    it('should decrypt encrypted data successfully', async () => {
      const plaintext = 'sensitive data';
      const encrypted = await encryptionService.encrypt(plaintext);
      const decrypted = await encryptionService.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should decrypt various data types as strings', async () => {
      const testCases = [
        'simple string',
        'unicode: こんにちは',
        'special chars: !@#$%^&*()',
        'long text '.repeat(100),
        JSON.stringify({ key: 'value', nested: { arr: [1, 2, 3] } }),
      ];

      for (const plaintext of testCases) {
        const encrypted = await encryptionService.encrypt(plaintext);
        const decrypted = await encryptionService.decrypt(encrypted);
        expect(decrypted).toBe(plaintext);
      }
    });

    it('should throw if SESSION_SECRET is not set', async () => {
      const encrypted = await encryptionService.encrypt('test');
      delete process.env.SESSION_SECRET;

      await expect(encryptionService.decrypt(encrypted)).rejects.toThrow(
        'SESSION_SECRET not set'
      );
    });

    it('should throw for invalid format', async () => {
      await expect(encryptionService.decrypt('invalid')).rejects.toThrow(
        'Failed to decrypt data'
      );
    });

    it('should throw for corrupted data', async () => {
      const encrypted = await encryptionService.encrypt('test');
      const corrupted = encrypted.replace(/[a-f]/g, '0');

      await expect(encryptionService.decrypt(corrupted)).rejects.toThrow(
        'Failed to decrypt data'
      );
    });

    it('should throw for tampered auth tag', async () => {
      const encrypted = await encryptionService.encrypt('test');
      const parts = encrypted.split(':');
      parts[2] = '00'.repeat(16);
      const tampered = parts.join(':');

      await expect(encryptionService.decrypt(tampered)).rejects.toThrow(
        'Failed to decrypt data'
      );
    });
  });

  describe('isEncrypted', () => {
    it('should return true for encrypted data', async () => {
      const encrypted = await encryptionService.encrypt('test');
      expect(encryptionService.isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plaintext', () => {
      expect(encryptionService.isEncrypted('plaintext')).toBe(false);
    });

    it('should return false for partial format', () => {
      expect(encryptionService.isEncrypted('abc:def')).toBe(false);
      expect(encryptionService.isEncrypted('abc:def:ghi')).toBe(false);
    });

    it('should return false for non-hex parts', () => {
      expect(encryptionService.isEncrypted('ghij:klmn:opqr:stuv')).toBe(false);
    });

    it('should return true for valid hex format', () => {
      expect(encryptionService.isEncrypted('0123:4567:89ab:cdef')).toBe(true);
    });
  });
});
