/**
 * AppView JWT Service
 *
 * Handles JWT operations for the AppView service according to AT Protocol specification.
 * The AppView signs JWTs for feed generator requests and verifies user-signed JWTs from PDS.
 */

import jwt from 'jsonwebtoken';
import fs from 'fs';
import crypto from 'crypto';
import { fromString, toString, concat } from 'uint8arrays';
import { secp256k1 } from '@noble/curves/secp256k1';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required');
}

const JWT_SECRET = process.env.SESSION_SECRET;
const PRIVATE_KEY_PATH =
  process.env.APPVIEW_PRIVATE_KEY_PATH || '/app/appview-private.pem';

/**
 * Extract raw private key bytes from PEM format
 */
const extractPrivateKeyFromPem = (pem: string): Uint8Array => {
  try {
    // Use Node.js crypto to parse the PEM and extract the raw key
    const keyObject = crypto.createPrivateKey({
      key: pem,
      format: 'pem',
    });

    // Export as JWK to get the raw 'd' parameter
    const jwk = keyObject.export({ format: 'jwk' }) as {
      d?: string;
      crv?: string;
    };

    if (!jwk.d) {
      throw new Error('Could not extract private key parameter from PEM');
    }

    // The 'd' parameter is base64url encoded
    return fromString(jwk.d, 'base64url');
  } catch (error) {
    console.error(
      '[AppViewJWT] Failed to extract private key from PEM:',
      error
    );
    throw new Error('Failed to extract private key from PEM');
  }
};

/**
 * Sign data using ES256K (secp256k1) algorithm
 * This is required because jsonwebtoken library doesn't support ES256K
 */
const signES256K = (privateKeyPem: string, data: string): string => {
  try {
    // Extract raw private key from PEM
    const privateKeyBytes = extractPrivateKeyFromPem(privateKeyPem);

    // Hash the data with SHA-256
    const dataBytes = new TextEncoder().encode(data);
    const msgHash = sha256(dataBytes);

    // Sign with secp256k1 using @noble/curves
    // lowS: true ensures canonical signature (low S value)
    const signature = secp256k1.sign(msgHash, privateKeyBytes, {
      lowS: true,
    });

    // Get signature in IEEE P1363 format (r || s) - 64 bytes
    const signatureBytes = signature.toCompactRawBytes();

    // Convert to base64url encoding for JWT
    return toString(signatureBytes, 'base64url');
  } catch (error) {
    console.error('[AppViewJWT] ES256K signing failed:', error);
    throw new Error('ES256K signing failed');
  }
};

/**
 * Create a JWT token with custom ES256K signing
 * This bypasses the jsonwebtoken library's algorithm validation
 */
const createJWTWithES256K = (
  payload:
    | AppViewJWTPayload
    | {
        iss: string;
        aud: string;
        sub: string;
        exp: number;
        iat: number;
        lxm: string;
      },
  privateKeyPem: string,
  keyid: string
): string => {
  try {
    // Create JWT header
    const header = {
      alg: 'ES256K',
      typ: 'JWT',
      kid: keyid,
    };

    // Encode header and payload
    const headerB64 = toString(fromString(JSON.stringify(header)), 'base64url');
    const payloadB64 = toString(
      fromString(JSON.stringify(payload)),
      'base64url'
    );

    // Create signing input
    const signingInput = `${headerB64}.${payloadB64}`;

    // Sign with ES256K
    const signature = signES256K(privateKeyPem, signingInput);

    // Return complete JWT
    return `${signingInput}.${signature}`;
  } catch (error) {
    console.error('[AppViewJWT] Custom JWT creation failed:', error);
    throw new Error('JWT creation failed');
  }
};

export interface AppViewJWTPayload {
  iss: string; // Issuer: AppView DID
  aud: string; // Audience: Feed generator DID
  exp: number; // Expiration timestamp
  iat: number; // Issued at timestamp
}

export interface UserSignedJWTPayload {
  iss: string; // Issuer: User's DID
  aud: string; // Audience: AppView DID
  sub: string; // Subject: User's DID
  exp: number; // Expiration timestamp
  iat: number; // Issued at timestamp
  lxm?: string; // Lexicon method (e.g., app.bsky.actor.getPreferences)
  jti?: string; // JWT ID (nonce)
}

export class AppViewJWTService {
  private appViewDid: string;
  private privateKeyPem: string | null;
  private signingAlg: 'ES256K' | 'HS256';

  constructor() {
    this.appViewDid = process.env.APPVIEW_DID || '';
    this.privateKeyPem = null;
    this.signingAlg = 'ES256K';

    if (!this.appViewDid) {
      throw new Error(
        '[AppViewJWT] APPVIEW_DID environment variable is required. ' +
          "Set APPVIEW_DID to your AppView's DID (e.g., did:web:appview.yourdomain.com)."
      );
    }

    // Prefer ES256K with a mounted private key PEM when available.
    try {
      if (fs.existsSync(PRIVATE_KEY_PATH)) {
        const pem = fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8').trim();
        if (
          pem.includes('BEGIN EC PRIVATE KEY') ||
          pem.includes('BEGIN PRIVATE KEY')
        ) {
          this.privateKeyPem = pem;
          this.signingAlg = 'ES256K';
          console.log(
            `[AppViewJWT] Loaded ES256K private key from ${PRIVATE_KEY_PATH}`
          );
        } else {
          console.warn(
            `[AppViewJWT] File at ${PRIVATE_KEY_PATH} does not look like a PEM private key; falling back to HS256.`
          );
        }
      } else {
        console.warn(
          `[AppViewJWT] Private key PEM not found at ${PRIVATE_KEY_PATH}; using HS256 with SESSION_SECRET.`
        );
      }
    } catch (err) {
      console.warn(
        `[AppViewJWT] Failed to initialize ES256K key from ${PRIVATE_KEY_PATH}; falling back to HS256:`,
        err
      );
    }
  }

  /**
   * Sign a JWT for feed generator requests (AppView to Feed Generator)
   * This is the ONLY case where the AppView signs its own tokens
   * @param feedGeneratorDid - The DID of the feed generator service
   * @returns Signed JWT token
   */
  signFeedGeneratorToken(feedGeneratorDid: string): string {
    const now = Math.floor(Date.now() / 1000);

    const payload: AppViewJWTPayload = {
      iss: this.appViewDid,
      aud: feedGeneratorDid,
      exp: now + 300, // 5 minutes
      iat: now,
    };

    // Use ES256K with proper key ID for AT Protocol compatibility
    if (this.privateKeyPem) {
      return createJWTWithES256K(payload, this.privateKeyPem, 'atproto');
    }

    // Fallback to HS256 only if no private key available
    console.warn(
      '[AppViewJWT] No private key available, using HS256 fallback for feed generator token.'
    );
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      keyid: 'atproto',
    });
  }

  /**
   * Create a service-auth token for PDS requests (AppView acting on behalf of user)
   * This allows the AppView to make authenticated requests to a user's PDS
   * @param userDid - The DID of the user we're acting on behalf of
   * @param pdsDid - The DID of the PDS we're making a request to
   * @param method - The lexicon method being called (e.g., app.bsky.actor.getPreferences)
   * @returns Signed service-auth JWT token
   */
  signServiceAuthToken(
    userDid: string,
    pdsDid: string,
    method: string
  ): string {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: this.appViewDid, // AppView is issuing the token
      aud: pdsDid, // PDS is the audience
      sub: userDid, // User is the subject (who we're acting on behalf of)
      exp: now + 60, // 1 minute expiration
      iat: now,
      lxm: method, // Lexicon method
    };

    // Use ES256K with proper key ID for AT Protocol compatibility
    if (this.privateKeyPem) {
      return createJWTWithES256K(payload, this.privateKeyPem, 'atproto');
    }

    // Fallback to HS256 only if no private key available
    console.warn(
      '[AppViewJWT] No private key available, using HS256 fallback for service-auth token.'
    );
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      keyid: 'atproto',
    });
  }

  /**
   * Verify a user-signed JWT token from PDS
   * This is the primary use case - verifying tokens signed by users' PDS
   * @param token - The JWT token to verify
   * @param expectedMethod - The expected lexicon method (e.g., app.bsky.actor.getPreferences)
   * @returns Decoded payload if valid, null if invalid
   */
  async verifyUserSignedToken(
    token: string,
    expectedMethod?: string
  ): Promise<UserSignedJWTPayload | null> {
    try {
      // Decode without verification to check token structure
      const decoded = jwt.decode(token, { complete: true }) as {
        header: { alg: string; kid?: string };
        payload: UserSignedJWTPayload;
      } | null;

      if (!decoded || !decoded.payload) {
        console.log('[AppViewJWT] Failed to decode user-signed token');
        return null;
      }

      const payload = decoded.payload;

      // Validate required fields
      if (!payload.iss || !payload.aud || !payload.sub) {
        console.log('[AppViewJWT] User-signed token missing required fields');
        return null;
      }

      // Check audience matches this AppView
      if (payload.aud !== this.appViewDid) {
        console.log(
          `[AppViewJWT] Token audience mismatch: expected ${this.appViewDid}, got ${payload.aud}`
        );
        return null;
      }

      // Check subject matches issuer (user signing for themselves)
      if (payload.sub !== payload.iss) {
        console.log(
          `[AppViewJWT] Token subject mismatch: expected ${payload.iss}, got ${payload.sub}`
        );
        return null;
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        console.log('[AppViewJWT] User-signed token has expired');
        return null;
      }

      // Check method if specified
      if (expectedMethod && payload.lxm && payload.lxm !== expectedMethod) {
        console.log(
          `[AppViewJWT] Token method mismatch: expected ${expectedMethod}, got ${payload.lxm}`
        );
        return null;
      }

      // Verify signature using user's public key
      const verified = await this.verifyJWTSignature(token, payload.iss);

      if (!verified) {
        console.error(
          `[AppViewJWT] Signature verification failed for user DID: ${payload.iss}`
        );
        return null;
      }

      console.log(
        `[AppViewJWT] ✓ User-signed token verified for DID: ${payload.iss}`
      );
      return payload;
    } catch (error) {
      console.error(
        '[AppViewJWT] User-signed token verification failed:',
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Verify JWT signature using the signer's public key from their DID document
   */
  private async verifyJWTSignature(
    token: string,
    signerDid: string
  ): Promise<boolean> {
    try {
      const [headerB64, payloadB64, signatureB64] = token.split('.');
      if (!headerB64 || !payloadB64 || !signatureB64) {
        throw new Error('Invalid JWT structure');
      }

      const header = JSON.parse(
        toString(fromString(headerB64, 'base64url'))
      ) as { alg: string; kid?: string };

      const { didResolver } = await import('./did-resolver');
      const didDocument = await didResolver.resolveDID(signerDid);

      if (!didDocument || !didDocument.verificationMethod) {
        console.error(
          `[AppViewJWT] No verification methods found for DID: ${signerDid}`
        );
        return false;
      }

      const { kid } = header;
      const verificationMethods = didDocument.verificationMethod || [];

      let method;

      if (kid) {
        method = verificationMethods.find(
          (m) => m.id.endsWith(`#${kid}`) || m.id === kid
        );
      } else {
        const atprotoKeys = verificationMethods.filter((m) =>
          m.id.endsWith('#atproto')
        );
        if (atprotoKeys.length === 1) {
          console.log(
            `[AppViewJWT] JWT missing 'kid', using unique #atproto key for DID ${signerDid}`
          );
          method = atprotoKeys[0];
        } else {
          throw new Error(
            "JWT missing 'kid' and could not find a unique '#atproto' verification key."
          );
        }
      }

      if (!method) {
        throw new Error(`No verification method found for kid: ${kid}`);
      }

      // Handle different key formats and algorithms
      if (header.alg === 'ES256K') {
        return this.verifyES256KSignature(
          method,
          headerB64,
          payloadB64,
          signatureB64
        );
      } else if (header.alg === 'ES256') {
        return this.verifyES256Signature(method, token);
      } else {
        throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
      }
    } catch (error) {
      console.error(
        `[AppViewJWT] Signature verification failed for DID ${signerDid}:`,
        error
      );
      return false;
    }
  }

  private verifyES256KSignature(
    method: {
      publicKeyJwk?: { crv?: string; x?: string; y?: string };
      publicKeyMultibase?: string;
    },
    headerB64: string,
    payloadB64: string,
    signatureB64: string
  ): boolean {
    try {
      // Decode signature from base64url (IEEE P1363 format: r || s)
      const signatureBytes = fromString(signatureB64, 'base64url');

      // Create the signing input and hash it
      const signingInput = `${headerB64}.${payloadB64}`;
      const msgHash = sha256(new TextEncoder().encode(signingInput));

      let publicKeyBytes: Uint8Array;

      if (method.publicKeyJwk) {
        const jwk = method.publicKeyJwk;
        if (jwk.crv !== 'secp256k1' || !jwk.x || !jwk.y) {
          throw new Error('Invalid JWK for ES256K');
        }
        const x = fromString(jwk.x, 'base64url');
        const y = fromString(jwk.y, 'base64url');
        // Uncompressed public key format: 0x04 || x || y
        publicKeyBytes = concat([new Uint8Array([0x04]), x, y]);
      } else if (method.publicKeyMultibase) {
        const { base58btc } = require('multiformats/bases/base58');
        const { varint } = require('multiformats');
        const multicodecBytes = base58btc.decode(method.publicKeyMultibase);
        const [codec, bytesRead] = varint.decode(multicodecBytes);
        if (codec !== 0xe7) throw new Error('Key is not ES256K');

        const keyBytes = multicodecBytes.subarray(bytesRead);
        if (keyBytes.length === 33) {
          // Compressed key - decompress using @noble/curves
          const point = secp256k1.ProjectivePoint.fromHex(keyBytes);
          publicKeyBytes = point.toRawBytes(false); // false = uncompressed
        } else if (keyBytes.length === 65 && keyBytes[0] === 0x04) {
          publicKeyBytes = keyBytes;
        } else {
          throw new Error('Invalid ES256K public key format');
        }
      } else {
        throw new Error('No supported key format found for ES256K');
      }

      // Verify the signature using @noble/curves
      // signatureBytes is already in compact format (r || s), which verify() accepts directly
      const verified = secp256k1.verify(
        signatureBytes,
        msgHash,
        publicKeyBytes
      );

      if (!verified) {
        throw new Error('ES256K signature verification failed');
      }

      return true;
    } catch (error) {
      console.error(
        '[AppViewJWT] ES256K signature verification failed:',
        error
      );
      return false;
    }
  }

  private async verifyES256Signature(
    method: {
      publicKeyJwk?: Record<string, unknown>;
      publicKeyMultibase?: string;
    },
    token: string
  ): Promise<boolean> {
    try {
      const { base58btc } = require('multiformats/bases/base58');
      const { varint } = require('multiformats');
      const jose = require('jose');

      // Use jose for ES256, which is well-supported
      const getKey = async () => {
        if (method.publicKeyJwk) {
          return jose.importJWK(method.publicKeyJwk, 'ES256');
        }
        if (method.publicKeyMultibase) {
          const multicodecBytes = base58btc.decode(method.publicKeyMultibase);
          const [codec, bytesRead] = varint.decode(multicodecBytes);
          if (codec !== 0x1200) throw new Error('Key is not ES256');

          const keyBytes = multicodecBytes.subarray(bytesRead);
          let x: Uint8Array, y: Uint8Array;
          if (keyBytes.length === 65 && keyBytes[0] === 0x04) {
            x = keyBytes.subarray(1, 33);
            y = keyBytes.subarray(33, 65);
          } else if (keyBytes.length === 33) {
            // Compressed key - decompress using @noble/curves p256
            const point = p256.ProjectivePoint.fromHex(keyBytes);
            const uncompressed = point.toRawBytes(false);
            x = uncompressed.subarray(1, 33);
            y = uncompressed.subarray(33, 65);
          } else {
            throw new Error('Invalid ES256 public key format');
          }
          const jwk = {
            kty: 'EC',
            crv: 'P-256',
            x: toString(x, 'base64url'),
            y: toString(y, 'base64url'),
          };
          return jose.importJWK(jwk, 'ES256');
        }
        throw new Error('No supported key format found for ES256');
      };

      await jose.jwtVerify(token, getKey);
      return true;
    } catch (error) {
      console.error('[AppViewJWT] ES256 signature verification failed:', error);
      return false;
    }
  }

  /**
   * Get the AppView DID
   */
  getAppViewDid(): string {
    return this.appViewDid;
  }

  /**
   * Verify a JWT token (for testing/validation) - only for AppView-signed tokens
   */
  verifyToken(token: string): AppViewJWTPayload | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AppViewJWTPayload;
      return payload;
    } catch (error) {
      console.error('[AppViewJWT] Token verification failed:', error);
      return null;
    }
  }
}

export const appViewJWTService = new AppViewJWTService();
