import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isUrlSafeToFetch,
  sanitizeUrlPath,
  isContentTypeSafe,
  sanitizeResponseHeaders,
  isValidDID,
  isValidCID,
  buildSafeBlobUrl,
  safeFetch,
  sanitizeHtmlOutput,
} from '../../server/utils/security';

describe('isUrlSafeToFetch', () => {
  describe('valid URLs', () => {
    it('should allow HTTPS URLs', () => {
      expect(isUrlSafeToFetch('https://example.com')).toBe(true);
      expect(isUrlSafeToFetch('https://api.bsky.app/xrpc/test')).toBe(true);
    });

    it('should allow HTTP URLs', () => {
      expect(isUrlSafeToFetch('http://example.com')).toBe(true);
    });

    it('should allow public IP addresses', () => {
      expect(isUrlSafeToFetch('http://8.8.8.8')).toBe(true);
      expect(isUrlSafeToFetch('https://1.1.1.1')).toBe(true);
    });
  });

  describe('blocked protocols', () => {
    it('should block file:// protocol', () => {
      expect(isUrlSafeToFetch('file:///etc/passwd')).toBe(false);
    });

    it('should block ftp:// protocol', () => {
      expect(isUrlSafeToFetch('ftp://example.com')).toBe(false);
    });

    it('should block javascript: protocol', () => {
      expect(isUrlSafeToFetch('javascript:alert(1)')).toBe(false);
    });

    it('should block data: protocol', () => {
      expect(isUrlSafeToFetch('data:text/html,<script>alert(1)</script>')).toBe(
        false
      );
    });
  });

  describe('blocked localhost', () => {
    it('should block localhost', () => {
      expect(isUrlSafeToFetch('http://localhost')).toBe(false);
      expect(isUrlSafeToFetch('http://localhost:8080')).toBe(false);
    });

    it('should block 127.0.0.1', () => {
      expect(isUrlSafeToFetch('http://127.0.0.1')).toBe(false);
      expect(isUrlSafeToFetch('http://127.0.0.1:3000')).toBe(false);
    });

    it('should block 0.0.0.0', () => {
      expect(isUrlSafeToFetch('http://0.0.0.0')).toBe(false);
    });

    it('should block IPv6 localhost', () => {
      expect(isUrlSafeToFetch('http://[::1]')).toBe(false);
      expect(isUrlSafeToFetch('http://::1')).toBe(false);
    });
  });

  describe('blocked private IP ranges', () => {
    it('should block 10.0.0.0/8', () => {
      expect(isUrlSafeToFetch('http://10.0.0.1')).toBe(false);
      expect(isUrlSafeToFetch('http://10.255.255.255')).toBe(false);
    });

    it('should block 172.16.0.0/12', () => {
      expect(isUrlSafeToFetch('http://172.16.0.1')).toBe(false);
      expect(isUrlSafeToFetch('http://172.31.255.255')).toBe(false);
    });

    it('should allow 172.x outside /12 range', () => {
      expect(isUrlSafeToFetch('http://172.15.0.1')).toBe(true);
      expect(isUrlSafeToFetch('http://172.32.0.1')).toBe(true);
    });

    it('should block 192.168.0.0/16', () => {
      expect(isUrlSafeToFetch('http://192.168.0.1')).toBe(false);
      expect(isUrlSafeToFetch('http://192.168.255.255')).toBe(false);
    });

    it('should block 169.254.0.0/16 (link-local)', () => {
      expect(isUrlSafeToFetch('http://169.254.0.1')).toBe(false);
      expect(isUrlSafeToFetch('http://169.254.169.254')).toBe(false);
    });

    it('should block 127.0.0.0/8 (loopback)', () => {
      expect(isUrlSafeToFetch('http://127.0.0.1')).toBe(false);
      expect(isUrlSafeToFetch('http://127.255.255.255')).toBe(false);
    });
  });

  describe('blocked private IPv6', () => {
    it('should block fe80:: (link-local)', () => {
      expect(isUrlSafeToFetch('http://fe80::1')).toBe(false);
      expect(isUrlSafeToFetch('http://[fe80::1]')).toBe(false);
    });

    it('should block fc00::/fd00:: (unique local)', () => {
      expect(isUrlSafeToFetch('http://fc00::1')).toBe(false);
      expect(isUrlSafeToFetch('http://fd00::1')).toBe(false);
      expect(isUrlSafeToFetch('http://[fc00::1]')).toBe(false);
    });
  });

  describe('invalid URLs', () => {
    it('should return false for invalid URL format', () => {
      expect(isUrlSafeToFetch('not-a-url')).toBe(false);
      expect(isUrlSafeToFetch('')).toBe(false);
    });
  });
});

describe('sanitizeUrlPath', () => {
  it('should remove null bytes', () => {
    expect(sanitizeUrlPath('path\u0000/to/file')).toBe('path/to/file');
  });

  it('should remove script tags', () => {
    expect(sanitizeUrlPath('path<script>alert(1)</script>/file')).toBe(
      'path/file'
    );
  });

  it('should remove javascript: protocol', () => {
    expect(sanitizeUrlPath('javascript:alert(1)')).toBe('alert(1)');
  });

  it('should remove event handlers', () => {
    expect(sanitizeUrlPath('path?onclick=alert(1)')).toBe('path?alert(1)');
    expect(sanitizeUrlPath('onmouseover=bad')).toBe('bad');
  });

  it('should truncate URLs over 2048 characters', () => {
    const longUrl = 'a'.repeat(3000);
    expect(sanitizeUrlPath(longUrl).length).toBe(2048);
  });

  it('should preserve normal URLs', () => {
    expect(sanitizeUrlPath('/api/users?id=123')).toBe('/api/users?id=123');
  });
});

describe('isContentTypeSafe', () => {
  it('should return false for undefined', () => {
    expect(isContentTypeSafe(undefined)).toBe(false);
  });

  it('should block HTML content types', () => {
    expect(isContentTypeSafe('text/html')).toBe(false);
    expect(isContentTypeSafe('text/html; charset=utf-8')).toBe(false);
    expect(isContentTypeSafe('application/xhtml+xml')).toBe(false);
  });

  it('should allow JSON', () => {
    expect(isContentTypeSafe('application/json')).toBe(true);
    expect(isContentTypeSafe('application/json; charset=utf-8')).toBe(true);
  });

  it('should allow JavaScript', () => {
    expect(isContentTypeSafe('application/javascript')).toBe(true);
  });

  it('should allow plain text', () => {
    expect(isContentTypeSafe('text/plain')).toBe(true);
  });

  it('should allow images', () => {
    expect(isContentTypeSafe('image/png')).toBe(true);
    expect(isContentTypeSafe('image/jpeg')).toBe(true);
    expect(isContentTypeSafe('image/webp')).toBe(true);
  });

  it('should allow video', () => {
    expect(isContentTypeSafe('video/mp4')).toBe(true);
    expect(isContentTypeSafe('video/webm')).toBe(true);
  });

  it('should allow audio', () => {
    expect(isContentTypeSafe('audio/mpeg')).toBe(true);
    expect(isContentTypeSafe('audio/ogg')).toBe(true);
  });

  it('should allow binary/octet-stream', () => {
    expect(isContentTypeSafe('application/octet-stream')).toBe(true);
  });

  it('should allow AT Protocol types', () => {
    expect(isContentTypeSafe('application/cbor')).toBe(true);
    expect(isContentTypeSafe('application/vnd.ipld.car')).toBe(true);
  });
});

describe('sanitizeResponseHeaders', () => {
  it('should keep safe headers', () => {
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': '100',
      'Cache-Control': 'max-age=3600',
    };
    const sanitized = sanitizeResponseHeaders(headers);
    expect(sanitized['Content-Type']).toBe('application/json');
    expect(sanitized['Content-Length']).toBe('100');
    expect(sanitized['Cache-Control']).toBe('max-age=3600');
  });

  it('should remove unsafe headers', () => {
    const headers = {
      'Content-Type': 'application/json',
      'Set-Cookie': 'session=abc123',
      'X-Custom-Header': 'value',
    };
    const sanitized = sanitizeResponseHeaders(headers);
    expect(sanitized['Content-Type']).toBe('application/json');
    expect(sanitized['Set-Cookie']).toBeUndefined();
    expect(sanitized['X-Custom-Header']).toBeUndefined();
  });

  it('should allow rate limit headers', () => {
    const headers = {
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '99',
      'X-RateLimit-Reset': '1234567890',
    };
    const sanitized = sanitizeResponseHeaders(headers);
    expect(sanitized['X-RateLimit-Limit']).toBe('100');
    expect(sanitized['X-RateLimit-Remaining']).toBe('99');
    expect(sanitized['X-RateLimit-Reset']).toBe('1234567890');
  });

  it('should sanitize header values', () => {
    const headers = {
      'Content-Type': 'text/plain<script>alert(1)</script>',
    };
    const sanitized = sanitizeResponseHeaders(headers);
    expect(sanitized['Content-Type']).toBe('text/plain');
  });

  it('should preserve non-string values', () => {
    const headers = {
      'Content-Length': 100,
    };
    const sanitized = sanitizeResponseHeaders(headers);
    expect(sanitized['Content-Length']).toBe(100);
  });
});

describe('isValidDID', () => {
  it('should validate correct DID:plc format', () => {
    expect(isValidDID('did:plc:abc123xyz')).toBe(true);
    expect(isValidDID('did:plc:ewvi7nxzyoun6zhxrhs64oiz')).toBe(true);
  });

  it('should validate correct DID:web format', () => {
    expect(isValidDID('did:web:example.com')).toBe(true);
    expect(isValidDID('did:web:bsky.social')).toBe(true);
  });

  it('should reject empty or null', () => {
    expect(isValidDID('')).toBe(false);
    expect(isValidDID(null as unknown as string)).toBe(false);
    expect(isValidDID(undefined as unknown as string)).toBe(false);
  });

  it('should reject invalid formats', () => {
    expect(isValidDID('not-a-did')).toBe(false);
    expect(isValidDID('did:')).toBe(false);
    expect(isValidDID('did:plc')).toBe(false);
    expect(isValidDID('did:plc:')).toBe(false);
  });

  it('should reject DIDs over 256 characters', () => {
    const longDid = 'did:plc:' + 'a'.repeat(250);
    expect(isValidDID(longDid)).toBe(false);
  });

  it('should reject non-string input', () => {
    expect(isValidDID(123 as unknown as string)).toBe(false);
    expect(isValidDID({} as unknown as string)).toBe(false);
  });
});

describe('isValidCID', () => {
  it('should validate CIDv0 (Qm...)', () => {
    expect(isValidCID('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')).toBe(
      true
    );
  });

  it('should validate CIDv1 base32 (b...)', () => {
    expect(
      isValidCID('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')
    ).toBe(true);
  });

  it('should validate CIDv1 base58 (z...)', () => {
    expect(
      isValidCID('zdpuAyvkgEDQm9TenwGkd5eNaosSxjgEYd8QatfPetgB1CdEZ')
    ).toBe(true);
  });

  it('should validate raw hex CIDs', () => {
    expect(
      isValidCID(
        '0155122090e1c1d9ae0e9a4b53a90b4f65b0bf1e4a0f0e1c1d9ae0e9a4b53a90b4f65b0bf1e4a'
      )
    ).toBe(true);
  });

  it('should reject empty or null', () => {
    expect(isValidCID('')).toBe(false);
    expect(isValidCID(null as unknown as string)).toBe(false);
    expect(isValidCID(undefined as unknown as string)).toBe(false);
  });

  it('should reject too short CIDs', () => {
    expect(isValidCID('abc')).toBe(false);
    expect(isValidCID('Qm123')).toBe(false);
  });

  it('should reject too long CIDs', () => {
    expect(isValidCID('a'.repeat(300))).toBe(false);
  });

  it('should reject non-string input', () => {
    expect(isValidCID(123 as unknown as string)).toBe(false);
  });
});

describe('buildSafeBlobUrl', () => {
  const validPds = 'https://bsky.social';
  const validDid = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz';
  const validCid =
    'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

  it('should build valid blob URL', () => {
    const url = buildSafeBlobUrl(validPds, validDid, validCid);
    expect(url).toBe(
      `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(validDid)}&cid=${validCid}`
    );
  });

  it('should return null for unsafe PDS endpoint', () => {
    expect(buildSafeBlobUrl('http://localhost', validDid, validCid)).toBeNull();
    expect(buildSafeBlobUrl('http://10.0.0.1', validDid, validCid)).toBeNull();
  });

  it('should return null for invalid DID', () => {
    expect(buildSafeBlobUrl(validPds, 'not-a-did', validCid)).toBeNull();
  });

  it('should return null for invalid CID', () => {
    expect(buildSafeBlobUrl(validPds, validDid, 'invalid')).toBeNull();
  });

  it('should return null for invalid URL', () => {
    expect(buildSafeBlobUrl('not-a-url', validDid, validCid)).toBeNull();
  });
});

describe('safeFetch', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue(new Response('ok'));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should fetch safe URLs', async () => {
    await safeFetch('https://example.com/api');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/api',
      undefined
    );
  });

  it('should pass options to fetch', async () => {
    const options = { headers: { 'X-Test': 'value' } };
    await safeFetch('https://example.com/api', options);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/api',
      options
    );
  });

  it('should throw for unsafe URLs', async () => {
    await expect(safeFetch('http://localhost/api')).rejects.toThrow(
      'URL failed SSRF validation'
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should throw for private IPs', async () => {
    await expect(safeFetch('http://192.168.1.1/api')).rejects.toThrow(
      'URL failed SSRF validation'
    );
  });
});

describe('sanitizeHtmlOutput', () => {
  it('should remove script tags', () => {
    const html = '<div>Hello<script>alert(1)</script>World</div>';
    expect(sanitizeHtmlOutput(html)).toBe('<div>HelloWorld</div>');
  });

  it('should remove multiline script tags', () => {
    const html = '<div><script>\nalert(1)\n</script></div>';
    expect(sanitizeHtmlOutput(html)).toBe('<div></div>');
  });

  it('should remove iframe tags', () => {
    const html = '<div><iframe src="http://evil.com"></iframe></div>';
    expect(sanitizeHtmlOutput(html)).toBe('<div></div>');
  });

  it('should remove object tags', () => {
    const html = '<div><object data="flash.swf"></object></div>';
    expect(sanitizeHtmlOutput(html)).toBe('<div></div>');
  });

  it('should remove embed tags', () => {
    const html = '<div><embed src="flash.swf"></div>';
    expect(sanitizeHtmlOutput(html)).toBe('<div></div>');
  });

  it('should remove inline event handlers', () => {
    const html = '<div onclick="alert(1)">Click</div>';
    expect(sanitizeHtmlOutput(html)).toBe('<div>Click</div>');
  });

  it('should remove multiple event handlers', () => {
    const html = '<div onclick="a()" onmouseover="b()">Text</div>';
    expect(sanitizeHtmlOutput(html)).toBe('<div>Text</div>');
  });

  it('should replace javascript: hrefs', () => {
    const html = '<a href="javascript:alert(1)">Link</a>';
    expect(sanitizeHtmlOutput(html)).toBe('<a href="#">Link</a>');
  });

  it('should replace javascript: src', () => {
    const html = '<img src="javascript:alert(1)">';
    expect(sanitizeHtmlOutput(html)).toBe('<img src="">');
  });

  it('should remove data: URIs in src', () => {
    const html = '<img src="data:text/html,<script>alert(1)</script>">';
    expect(sanitizeHtmlOutput(html)).toBe('<img src="">');
  });

  it('should preserve safe HTML', () => {
    const html = '<div class="container"><p>Hello World</p></div>';
    expect(sanitizeHtmlOutput(html)).toBe(html);
  });
});
