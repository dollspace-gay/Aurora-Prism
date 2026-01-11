/**
 * Security utilities for input validation and sanitization
 */

import dns from 'dns/promises';

// DNS cache for validated hostnames (prevents repeated lookups)
const dnsCache = new Map<string, { valid: boolean; expires: number }>();
const DNS_CACHE_TTL = 300000; // 5 minutes

/**
 * Apply a regex replacement repeatedly until no more matches are found.
 * This prevents multi-character sanitization bypass attacks where
 * malicious patterns reform after a single replacement pass.
 */
function replaceUntilStable(
  input: string,
  pattern: RegExp,
  replacement: string
): string {
  let result = input;
  let previous: string;
  do {
    previous = result;
    result = result.replace(pattern, replacement);
  } while (result !== previous);
  return result;
}

/**
 * Checks if an IP address is safe (not private, loopback, or link-local)
 * Used for both URL validation and DNS rebinding protection
 * @param ip The IP address to check
 * @returns true if the IP is safe (public), false if private/internal
 */
export function isIpAddressSafe(ip: string): boolean {
  // Check IPv4 addresses
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipv4Match = ip.match(ipv4Regex);

  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);

    // Validate octet ranges
    if (octets.some((o) => o < 0 || o > 255)) {
      return false;
    }

    // 10.0.0.0/8 (private)
    if (octets[0] === 10) {
      return false;
    }

    // 172.16.0.0/12 (private)
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
      return false;
    }

    // 192.168.0.0/16 (private)
    if (octets[0] === 192 && octets[1] === 168) {
      return false;
    }

    // 169.254.0.0/16 (link-local)
    if (octets[0] === 169 && octets[1] === 254) {
      return false;
    }

    // 127.0.0.0/8 (loopback)
    if (octets[0] === 127) {
      return false;
    }

    // 0.0.0.0/8 (current network)
    if (octets[0] === 0) {
      return false;
    }

    // 100.64.0.0/10 (carrier-grade NAT)
    if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) {
      return false;
    }

    // 192.0.0.0/24 (IETF protocol assignments)
    if (octets[0] === 192 && octets[1] === 0 && octets[2] === 0) {
      return false;
    }

    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (documentation)
    if (
      (octets[0] === 192 && octets[1] === 0 && octets[2] === 2) ||
      (octets[0] === 198 && octets[1] === 51 && octets[2] === 100) ||
      (octets[0] === 203 && octets[1] === 0 && octets[2] === 113)
    ) {
      return false;
    }

    // 224.0.0.0/4 (multicast)
    if (octets[0] >= 224 && octets[0] <= 239) {
      return false;
    }

    // 240.0.0.0/4 (reserved)
    if (octets[0] >= 240) {
      return false;
    }

    return true;
  }

  // Check IPv6 addresses
  const lowerIp = ip.toLowerCase();

  // Remove brackets if present
  const cleanIp = lowerIp.replace(/^\[|\]$/g, '');

  // Loopback (::1)
  if (cleanIp === '::1' || cleanIp === '0:0:0:0:0:0:0:1') {
    return false;
  }

  // Unspecified (::)
  if (cleanIp === '::' || cleanIp === '0:0:0:0:0:0:0:0') {
    return false;
  }

  // Link-local (fe80::/10)
  if (
    cleanIp.startsWith('fe8') ||
    cleanIp.startsWith('fe9') ||
    cleanIp.startsWith('fea') ||
    cleanIp.startsWith('feb')
  ) {
    return false;
  }

  // Unique local addresses (fc00::/7)
  if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) {
    return false;
  }

  // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
  const ipv4MappedMatch = cleanIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4MappedMatch) {
    return isIpAddressSafe(ipv4MappedMatch[1]);
  }

  return true;
}

/**
 * Validates DNS resolution results to prevent DNS rebinding attacks
 * Resolves the hostname and checks that all returned IPs are safe
 * @param hostname The hostname to validate
 * @returns true if all resolved IPs are safe, false otherwise
 */
async function validateDNS(hostname: string): Promise<boolean> {
  try {
    // Resolve both IPv4 and IPv6 addresses
    const [ipv4Result, ipv6Result] = await Promise.allSettled([
      dns.resolve4(hostname),
      dns.resolve6(hostname),
    ]);

    const allAddresses: string[] = [];

    if (ipv4Result.status === 'fulfilled') {
      allAddresses.push(...ipv4Result.value);
    }
    if (ipv6Result.status === 'fulfilled') {
      allAddresses.push(...ipv6Result.value);
    }

    // If no addresses resolved, fail closed
    if (allAddresses.length === 0) {
      console.warn(`[SECURITY] No DNS records for ${hostname}`);
      return false;
    }

    // Validate each resolved IP against private ranges
    for (const ip of allAddresses) {
      if (!isIpAddressSafe(ip)) {
        console.warn(`[SECURITY] DNS rebinding blocked: ${hostname} → ${ip}`);
        return false;
      }
    }

    return true;
  } catch (err) {
    // DNS lookup failed - fail closed for security
    console.error(`[SECURITY] DNS lookup failed for ${hostname}:`, err);
    return false;
  }
}

/**
 * Validates DNS with caching to avoid repeated lookups
 * @param hostname The hostname to validate
 * @returns true if DNS resolves to safe IPs, false otherwise
 */
export async function validateDNSWithCache(hostname: string): Promise<boolean> {
  // Check cache first
  const cached = dnsCache.get(hostname);
  if (cached && cached.expires > Date.now()) {
    return cached.valid;
  }

  // Perform DNS validation
  const valid = await validateDNS(hostname);

  // Cache the result
  dnsCache.set(hostname, {
    valid,
    expires: Date.now() + DNS_CACHE_TTL,
  });

  return valid;
}

/**
 * Validates that a URL is safe to fetch from (prevents SSRF attacks)
 * @param url The URL to validate
 * @returns true if the URL is safe, false otherwise
 */
export function isUrlSafeToFetch(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Only allow HTTP/HTTPS protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    // Prevent requests to localhost or private IP ranges
    const hostname = parsed.hostname.toLowerCase();

    // Block localhost variants
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]' ||
      hostname === '::1'
    ) {
      return false;
    }

    // Block private IP ranges (IPv4)
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipv4Match = hostname.match(ipv4Regex);

    if (ipv4Match) {
      const octets = ipv4Match.slice(1).map(Number);

      // 10.0.0.0/8
      if (octets[0] === 10) {
        return false;
      }

      // 172.16.0.0/12
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
        return false;
      }

      // 192.168.0.0/16
      if (octets[0] === 192 && octets[1] === 168) {
        return false;
      }

      // 169.254.0.0/16 (link-local)
      if (octets[0] === 169 && octets[1] === 254) {
        return false;
      }

      // 127.0.0.0/8 (loopback)
      if (octets[0] === 127) {
        return false;
      }
    }

    // Block private IPv6 ranges
    if (hostname.includes(':')) {
      // Simplified check for private IPv6 addresses
      const lowerHostname = hostname.toLowerCase();

      // Link-local addresses (fe80::/10)
      if (
        lowerHostname.startsWith('fe80:') ||
        lowerHostname.startsWith('[fe80:')
      ) {
        return false;
      }

      // Unique local addresses (fc00::/7)
      if (
        lowerHostname.startsWith('fc') ||
        lowerHostname.startsWith('fd') ||
        lowerHostname.startsWith('[fc') ||
        lowerHostname.startsWith('[fd')
      ) {
        return false;
      }
    }

    return true;
  } catch {
    // Invalid URL format
    return false;
  }
}

/**
 * Sanitizes a URL path for safe use in HTML transformation
 * Removes potentially dangerous characters and patterns
 * @param url The URL to sanitize
 * @returns The sanitized URL
 */
export function sanitizeUrlPath(url: string): string {
  // Remove any null bytes
  let sanitized = url.replace(/\0/g, '');

  // Remove any script tags or javascript: protocol (applied repeatedly to prevent bypass)
  // Note: closing tag pattern handles malformed tags like </script > or </script foo="bar">
  // The 's' flag enables dotAll mode so '.' matches newlines
  sanitized = replaceUntilStable(
    sanitized,
    /<script[^>]*>.*?<\/script\s*[^>]*>/gis,
    ''
  );
  sanitized = replaceUntilStable(sanitized, /javascript:/gi, '');
  sanitized = replaceUntilStable(sanitized, /on\w+=/gi, '');

  // Limit to reasonable length
  if (sanitized.length > 2048) {
    sanitized = sanitized.substring(0, 2048);
  }

  return sanitized;
}

/**
 * Validates that response content type is safe to proxy
 * @param contentType The content-type header value
 * @returns true if the content type is safe to proxy
 */
export function isContentTypeSafe(contentType: string | undefined): boolean {
  // Treat undefined content-type as unsafe to prevent content sniffing attacks
  // Default to application/octet-stream if needed
  if (!contentType) {
    return false;
  }

  const type = contentType.toLowerCase().split(';')[0].trim();

  // Block HTML content to prevent XSS
  if (type.includes('html')) {
    return false;
  }

  // Allow common safe content types
  const safeTypes = [
    'application/json',
    'application/javascript',
    'text/plain',
    'image/',
    'video/',
    'audio/',
    'application/octet-stream',
    'application/cbor',
    'application/vnd.ipld.car',
  ];

  return safeTypes.some((safe) => type.startsWith(safe));
}

/**
 * Sanitizes response headers to prevent XSS attacks
 * Removes potentially dangerous headers that could be exploited
 * @param headers The headers object to sanitize
 * @returns Sanitized headers object
 */
export function sanitizeResponseHeaders(
  headers: Record<string, string | number | string[] | undefined>
): Record<string, string | number | string[]> {
  const sanitized: Record<string, string | number | string[]> = {};

  // List of headers that are safe to forward
  const safeHeaders = [
    'content-type',
    'content-length',
    'content-encoding',
    'cache-control',
    'expires',
    'etag',
    'last-modified',
    'accept-ranges',
    'content-range',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
  ];

  // Helper to sanitize a single header value string
  // The 's' flag enables dotAll mode so '.' matches newlines
  const sanitizeHeaderValue = (v: string): string => {
    let s = replaceUntilStable(v, /<script[^>]*>.*?<\/script\s*[^>]*>/gis, '');
    s = replaceUntilStable(s, /javascript:/gi, '');
    s = replaceUntilStable(s, /on\w+=/gi, '');
    return s;
  };

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    // Only include safe headers with defined values
    if (safeHeaders.includes(lowerKey) && value !== undefined) {
      // Sanitize header values to remove potential script injection
      if (typeof value === 'string') {
        sanitized[key] = sanitizeHeaderValue(value);
      } else if (typeof value === 'number') {
        // Numbers are safe, pass through directly
        sanitized[key] = value;
      } else if (Array.isArray(value)) {
        // Sanitize each element in the array
        sanitized[key] = value.map(sanitizeHeaderValue);
      }
    }
  }

  return sanitized;
}

/**
 * Validates a DID (Decentralized Identifier) format
 * @param did The DID to validate
 * @returns true if the DID format is valid
 */
export function isValidDID(did: string): boolean {
  if (!did || typeof did !== 'string') {
    return false;
  }

  // DID format: did:method:identifier
  // Common methods: plc, web
  const didRegex = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;
  return didRegex.test(did) && did.length < 256;
}

/**
 * Validates a CID (Content Identifier) format
 * @param cid The CID to validate
 * @returns true if the CID format is valid
 */
export function isValidCID(cid: string): boolean {
  if (!cid || typeof cid !== 'string') {
    return false;
  }

  // Reasonable length check (CIDs should not be excessively long)
  if (cid.length < 10 || cid.length > 256) {
    return false;
  }

  // CID validation supporting multiple encodings:
  // - CIDv0: base58btc, starts with 'Qm'
  // - CIDv1: base32 (starts with 'b'), base58btc (starts with 'z'), base16/hex (starts with 'f' or raw hex)

  // CIDv0 (base58btc): starts with Qm
  const cidv0Regex = /^Qm[1-9A-HJ-NP-Za-km-z]{44,}$/;

  // CIDv1 base32: starts with 'b' followed by base32 chars (a-z, 2-7)
  const cidv1Base32Regex = /^b[a-z2-7]{58,}$/;

  // CIDv1 base58btc: starts with 'z' followed by base58 chars
  const cidv1Base58Regex = /^z[1-9A-HJ-NP-Za-km-z]{48,}$/;

  // CIDv1 base16 (hex): starts with 'f' (multibase prefix for base16) followed by hex chars
  const cidv1Base16Regex = /^f[0-9a-f]{64,}$/i;

  // Raw hex format (without multibase prefix): starts with hex chars
  // This is used by some clients, particularly for avatars and images
  // Format: version (1 byte) + codec (varint) + multihash (variable length)
  // Common pattern: starts with 01 (version 1) followed by codec and hash
  const rawHexRegex = /^[0-9a-f]{64,}$/i;

  // Check if it matches any valid CID format
  const isValid =
    cidv0Regex.test(cid) ||
    cidv1Base32Regex.test(cid) ||
    cidv1Base58Regex.test(cid) ||
    cidv1Base16Regex.test(cid) ||
    rawHexRegex.test(cid);

  return isValid;
}

/**
 * Validates an AT Protocol handle format to prevent SSRF attacks
 * AT Protocol handles are domain names with specific format requirements
 * @param handle The handle to validate
 * @returns true if the handle format is valid and safe
 */
export function isValidHandle(handle: string): boolean {
  if (!handle || typeof handle !== 'string') {
    return false;
  }

  // Length limits
  if (handle.length < 3 || handle.length > 253) {
    return false;
  }

  // Must contain at least one dot (multi-label domain)
  if (!handle.includes('.')) {
    return false;
  }

  // Block IP addresses (IPv4)
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  if (ipv4Regex.test(handle)) {
    return false;
  }

  // Block localhost variants
  const lowerHandle = handle.toLowerCase();
  if (
    lowerHandle === 'localhost' ||
    lowerHandle.endsWith('.localhost') ||
    lowerHandle.endsWith('.local') ||
    lowerHandle.endsWith('.internal')
  ) {
    return false;
  }

  // Valid AT Protocol handle: lowercase alphanumeric with hyphens and dots
  // Labels can't start or end with hyphen, can't have consecutive dots
  const handleRegex = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
  if (!handleRegex.test(handle)) {
    return false;
  }

  // Check individual label lengths (max 63 chars per DNS label)
  const labels = handle.split('.');
  for (const label of labels) {
    if (label.length > 63 || label.length === 0) {
      return false;
    }
  }

  return true;
}

/**
 * Reconstructs a safe blob URL after validation to prevent SSRF
 * @param pdsEndpoint The validated PDS endpoint
 * @param did The DID (must be pre-validated)
 * @param cid The CID (must be pre-validated)
 * @returns The reconstructed safe URL or null if validation fails
 */
export function buildSafeBlobUrl(
  pdsEndpoint: string,
  did: string,
  cid: string
): string | null {
  // Validate all inputs
  if (!isUrlSafeToFetch(pdsEndpoint) || !isValidDID(did) || !isValidCID(cid)) {
    return null;
  }

  try {
    // Parse the PDS endpoint to ensure it's a valid URL
    const parsedEndpoint = new URL(pdsEndpoint);

    // Reconstruct the URL using URL API to prevent injection
    const blobUrl = new URL('/xrpc/com.atproto.sync.getBlob', parsedEndpoint);
    blobUrl.searchParams.set('did', did);
    blobUrl.searchParams.set('cid', cid);

    return blobUrl.toString();
  } catch {
    return null;
  }
}

/**
 * Performs a fetch request with SSRF protection including DNS rebinding prevention
 * This wrapper function validates the URL and DNS resolution to prevent attacks
 * where a hostname initially resolves to a public IP but later to a private IP.
 *
 * @param validatedUrl The URL that has been validated by buildSafeBlobUrl or isUrlSafeToFetch
 * @param options Fetch options (headers, etc.)
 * @returns The fetch response
 * @throws Error if the URL is not safe or DNS validation fails
 */
export async function safeFetch(
  validatedUrl: string,
  options?: RequestInit
): Promise<Response> {
  // Step 1: URL format validation
  if (!isUrlSafeToFetch(validatedUrl)) {
    throw new Error('URL failed SSRF validation - refusing to fetch');
  }

  // Create a new URL object to extract hostname for DNS validation
  const safeUrl = new URL(validatedUrl);

  // Step 2: DNS rebinding protection - validate resolved IPs
  // Skip DNS validation for IP addresses (already validated by isUrlSafeToFetch)
  const isIpAddress =
    /^(\d{1,3}\.){3}\d{1,3}$/.test(safeUrl.hostname) ||
    safeUrl.hostname.includes(':');
  if (!isIpAddress) {
    const dnsValid = await validateDNSWithCache(safeUrl.hostname);
    if (!dnsValid) {
      throw new Error(
        `DNS validation failed for ${safeUrl.hostname} - possible DNS rebinding attack`
      );
    }
  }

  // Step 3: Perform the fetch with the validated URL
  return fetch(safeUrl.toString(), options);
}

/**
 * Sanitizes HTML content to prevent XSS attacks
 * WARNING: This is a minimal sanitizer for trusted internal HTML transformations only
 * For user-generated HTML content, use a robust library like DOMPurify
 *
 * This function is designed for Vite's transformIndexHtml output sanitization only.
 * It strips minimal XSS patterns but is NOT comprehensive enough for untrusted input.
 *
 * @param html The HTML content to sanitize (from trusted internal sources only)
 * @returns Sanitized HTML with minimal dangerous patterns removed
 */
export function sanitizeHtmlOutput(html: string): string {
  // SECURITY NOTE: This is NOT a comprehensive HTML sanitizer
  // This function only handles minimal XSS patterns for internal Vite HTML transformation
  // For untrusted user content, use a library like DOMPurify

  let sanitized = html;

  // Remove dangerous tags (applied repeatedly to prevent bypass)
  // Note: closing tag patterns handle malformed tags like </script > or </script foo="bar">
  sanitized = replaceUntilStable(
    sanitized,
    /<script[^>]*>.*?<\/script\s*[^>]*>/gis,
    ''
  );
  sanitized = replaceUntilStable(
    sanitized,
    /<iframe[^>]*>.*?<\/iframe\s*[^>]*>/gis,
    ''
  );
  sanitized = replaceUntilStable(
    sanitized,
    /<object[^>]*>.*?<\/object\s*[^>]*>/gis,
    ''
  );
  sanitized = replaceUntilStable(sanitized, /<embed[^>]*>/gi, '');

  // Remove inline event handlers (applied repeatedly to prevent bypass)
  sanitized = replaceUntilStable(
    sanitized,
    /\son\w+\s*=\s*["'][^"']*["']/gi,
    ''
  );

  // Remove javascript: protocol URLs (applied repeatedly to prevent bypass)
  sanitized = replaceUntilStable(
    sanitized,
    /href\s*=\s*["']javascript:[^"']*["']/gi,
    'href="#"'
  );
  sanitized = replaceUntilStable(
    sanitized,
    /src\s*=\s*["']javascript:[^"']*["']/gi,
    'src=""'
  );

  // Remove data: URIs that could contain malicious content
  sanitized = replaceUntilStable(
    sanitized,
    /src\s*=\s*["']data:[^"']*["']/gi,
    'src=""'
  );

  // Return the sanitized HTML
  return sanitized;
}
