import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import * as jose from 'jose';
import type { JWSHeaderParameters } from 'jose';
import { fromString, toString, concat } from 'uint8arrays';
import { base58btc } from 'multiformats/bases/base58';
import { varint } from 'multiformats';
import { secp256k1 } from '@noble/curves/secp256k1';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';

const verifyEs256kSig = (
  publicKey: Uint8Array,
  data: Uint8Array,
  sig: Uint8Array
): boolean => {
  try {
    // Hash the data with SHA-256
    const msgHash = sha256(data);

    // Verify using @noble/curves secp256k1
    // sig is in IEEE P1363 format (r || s), which verify() accepts directly
    return secp256k1.verify(sig, msgHash, publicKey);
  } catch (err) {
    console.error('[AUTH] Error during ES256K signature verification:', err);
    return false;
  }
};

/**
 * Validates that the SESSION_SECRET has sufficient entropy for secure use.
 * Throws an error if the secret is weak or potentially insecure.
 */
function validateSessionSecret(secret: string): void {
  const MIN_LENGTH = 32;

  // Check minimum length
  if (secret.length < MIN_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_LENGTH} characters (got ${secret.length})`
    );
  }

  // Reject known weak/default values
  const weakSecrets = [
    'change-me-in-production',
    'changeme',
    'secret',
    'password',
    'development-secret',
    'dev-secret',
    'test-secret',
    'your-secret-here',
    'replace-this-secret',
    'default-secret',
  ];

  const lowerSecret = secret.toLowerCase();
  for (const weak of weakSecrets) {
    if (lowerSecret.includes(weak)) {
      throw new Error(
        'SESSION_SECRET contains a known weak/default value. Generate a secure random secret.'
      );
    }
  }

  // Reject secrets that are all the same character (e.g., "aaaaaaaaaa...")
  if (/^(.)\1+$/.test(secret)) {
    throw new Error(
      'SESSION_SECRET consists of repeated characters. Generate a secure random secret.'
    );
  }

  // Check for minimum character diversity (at least 8 unique characters)
  const uniqueChars = new Set(secret).size;
  if (uniqueChars < 8) {
    throw new Error(
      `SESSION_SECRET has low entropy (only ${uniqueChars} unique characters). Use a more diverse secret.`
    );
  }
}

if (!process.env.SESSION_SECRET) {
  throw new Error(
    'SESSION_SECRET environment variable is required for production use'
  );
}

// Validate the secret has sufficient entropy
validateSessionSecret(process.env.SESSION_SECRET);

const JWT_SECRET = process.env.SESSION_SECRET;
const JWT_EXPIRY = '7d';

export interface SessionPayload {
  did: string;
  sessionId: string;
}

export interface AtProtoTokenPayload {
  sub: string; // User's DID
  iss: string; // Issuer (PDS endpoint or user DID for service auth)
  aud?: string; // Audience (this appview's DID)
  scope?: string;
  lxm?: string; // Lexicon method for service auth tokens
  iat: number;
  exp: number;
}

export class AuthService {
  createSessionToken(did: string, sessionId: string): string {
    return jwt.sign({ did, sessionId }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  }

  verifySessionToken(token: string): SessionPayload | null {
    try {
      // Decode the token to inspect the header without verifying the signature.
      // This allows us to quickly reject tokens that are not meant for this verification method.
      const decoded = jwt.decode(token, { complete: true });

      // Local session tokens are always signed with HS256. If the token has a different
      // algorithm, it's an AT-Proto token or something else, so we should not try to verify it here.
      if (decoded?.header.alg !== 'HS256') {
        return null; // Not a local session token, do not proceed.
      }

      // Now that we know it's an HS256 token, verify it with the secret.
      const payload = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
      }) as SessionPayload;
      return payload;
    } catch (error) {
      // This block will now only be reached for actual verification errors of HS256 tokens
      // (e.g., signature mismatch, expiration), not for algorithm mismatches.
      console.log(
        '[AUTH] Local session token verification failed:',
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Verify AT Protocol OAuth access token from third-party clients
   * With full cryptographic signature verification
   */
  async verifyAtProtoToken(token: string): Promise<{
    did: string;
    aud?: string;
    lxm?: string;
    scope?: string;
  } | null> {
    try {
      // Decode without verification to check token structure
      const decoded = jwt.decode(token, { complete: true }) as {
        header: { alg: string; kid?: string; typ?: string };
        payload: Record<string, unknown>;
      } | null;

      if (!decoded || !decoded.payload) {
        console.log('[AUTH] Failed to decode token');
        return null;
      }

      const header = decoded.header;
      const payload = decoded.payload as Record<string, unknown>;

      // SECURITY: Reject PDS-specific token types that should not reach AppViews
      // Per AT Protocol spec, these tokens are for PDS-to-client communication only
      // Reference: https://atproto.com/specs/xrpc (Domain Separation)
      const rejectedTypes = ['at+jwt', 'refresh+jwt', 'dpop+jwt'];
      if (header.typ && rejectedTypes.includes(header.typ)) {
        console.warn(
          '[AUTH] 🔒 Rejected token with typ: %s - PDS tokens should not reach AppView directly',
          header.typ
        );
        return null;
      }

      // AT Protocol supports two token formats:
      // 1. OAuth access tokens (RFC 9068): sub=userDID, iss=authServer, aud=resourceServer
      // 2. Service auth tokens: iss=userDID, aud=targetService, lxm=method

      let userDid: string | null = null;
      let signingDid: string | null = null;

      // Check for OAuth access token format (sub field with DID)
      const sub = payload.sub as string | undefined;
      const aud = payload.aud as string | undefined;
      const iss = payload.iss as string | undefined;
      const scope = payload.scope as string | undefined;
      const lxm = payload.lxm as string | undefined;

      if (sub && typeof sub === 'string' && sub.startsWith('did:')) {
        userDid = sub;

        // PDS-issued tokens: sub=userDID, aud=pdsDID, scope=com.atproto.access or com.atproto.appPassPrivileged
        // SECURITY: All JWTs MUST have their cryptographic signatures verified
        const pdsDid = aud;
        if (
          (scope === 'com.atproto.appPassPrivileged' ||
            scope === 'com.atproto.access') &&
          pdsDid &&
          typeof pdsDid === 'string' &&
          pdsDid.startsWith('did:')
        ) {
          // For PDS-issued tokens, the PDS is the signer
          signingDid = pdsDid;
          console.log(
            `[AUTH] PDS token detected (scope: ${scope}) for DID: ${sub} (from PDS: ${pdsDid}) - verifying signature`
          );
        }
        // OAuth tokens with iss field need signature verification
        else if (iss && typeof iss === 'string') {
          signingDid = iss;
        }
        // Fallback: use aud as signing DID if present
        else if (
          pdsDid &&
          typeof pdsDid === 'string' &&
          pdsDid.startsWith('did:')
        ) {
          signingDid = pdsDid;
          console.log(
            `[AUTH] Using aud field as signing DID for token from: ${pdsDid}`
          );
        } else {
          console.log(`[AUTH] OAuth token missing iss/aud field`);
          return null;
        }
      }
      // Check for AT Protocol service auth token format (iss field with DID, lxm field present)
      else if (
        iss &&
        typeof iss === 'string' &&
        iss.startsWith('did:') &&
        lxm
      ) {
        userDid = iss;
        signingDid = iss; // Token signed by user's DID
      } else {
        console.log(`[AUTH] Not an AT Protocol token - invalid structure`);
        return null;
      }

      if (!userDid || !signingDid) {
        return null;
      }

      // For PDS tokens (com.atproto.access scope), verify signature AND enforce freshness
      // SECURITY: All authentication tokens are now verified to prevent impersonation attacks.
      // NOTE: In standard AT Protocol flow, PDS access tokens shouldn't reach AppViews directly.
      // Clients talk to PDS, which proxies to AppView using service auth tokens.
      // This code path may be hit by non-standard direct-to-AppView clients.
      const isPdsToken =
        scope === 'com.atproto.access' ||
        scope === 'com.atproto.appPassPrivileged';

      const exp = payload.exp as number | undefined;
      const iat = payload.iat as number | undefined;

      if (isPdsToken) {
        // Enforce token freshness (5-minute window) to prevent replay attacks
        const now = Math.floor(Date.now() / 1000);
        const TOKEN_FRESHNESS_WINDOW = 300; // 5 minutes in seconds

        if (!iat) {
          console.error(
            '[AUTH] 🔒 SECURITY: PDS token rejected - missing iat claim. DID: %s, PDS: %s',
            userDid,
            signingDid
          );
          return null;
        }

        if (now - iat > TOKEN_FRESHNESS_WINDOW) {
          console.error(
            '[AUTH] 🔒 SECURITY: PDS token rejected - token too old (issued %d seconds ago). DID: %s, PDS: %s',
            now - iat,
            userDid,
            signingDid
          );
          return null;
        }

        // Verify signature for PDS tokens (critical security check)
        const verified = await this.verifyJWTSignature(token, signingDid);
        if (!verified) {
          console.error(
            '[AUTH] 🔒 SECURITY ALERT: PDS token signature verification FAILED. Possible forgery attempt. DID: %s, PDS: %s, scope: %s',
            userDid,
            signingDid,
            scope
          );
          return null;
        }

        console.warn(
          '[AUTH] ⚠️ PDS token verified (unusual flow) - DID: %s, PDS: %s, scope: %s, exp: %s',
          userDid,
          signingDid,
          scope,
          exp ? new Date(exp * 1000).toISOString() : 'none'
        );
        return {
          did: userDid,
          aud: aud,
          lxm: lxm,
          scope: scope,
        };
      }

      // For service auth tokens, validate expiration and verify signature
      // Per AT Protocol spec: exp is required for service auth tokens
      const now = Math.floor(Date.now() / 1000);

      if (!exp) {
        console.error(
          '[AUTH] 🔒 Service auth token rejected - missing exp claim. DID: %s',
          userDid
        );
        return null;
      }

      if (now > exp) {
        console.error(
          '[AUTH] 🔒 Service auth token rejected - expired %d seconds ago. DID: %s',
          now - exp,
          userDid
        );
        return null;
      }

      // Verify signature
      const verified = await this.verifyJWTSignature(token, signingDid);

      if (!verified) {
        console.error(
          '[AUTH] 🔒 SECURITY ALERT: Service auth token signature verification FAILED. DID: %s, signer: %s',
          userDid,
          signingDid
        );
        return null;
      }

      console.log(
        '[AUTH] ✓ AT Protocol service token verified for DID: %s (signed by: %s, lxm: %s)',
        userDid,
        signingDid,
        lxm || 'none'
      );
      return {
        did: userDid,
        aud: aud,
        lxm: lxm,
      };
    } catch (error) {
      console.error(
        '[AUTH] AT Protocol token verification failed:',
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  private async verifyJWTSignature(
    token: string,
    signingDid: string
  ): Promise<boolean> {
    try {
      const [headerB64, payloadB64, signatureB64] = token.split('.');
      if (!headerB64 || !payloadB64 || !signatureB64) {
        throw new Error('Invalid JWT structure');
      }
      const header = JSON.parse(
        toString(fromString(headerB64, 'base64url'))
      ) as JWSHeaderParameters;

      const { didResolver } = await import('./did-resolver');
      const didDocument = await didResolver.resolveDID(signingDid);

      if (!didDocument || !didDocument.verificationMethod) {
        console.error(
          `[AUTH] No verification methods found for DID: ${signingDid}`
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
            `[AUTH] JWT missing 'kid', using unique #atproto key for DID ${signingDid}`
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

      if (header.alg === 'ES256K') {
        // Manually verify ES256K signatures using @noble/curves
        const signingInput = fromString(`${headerB64}.${payloadB64}`);
        const signature = fromString(signatureB64, 'base64url');

        let publicKeyBytes: Uint8Array;

        if (method.publicKeyJwk) {
          const jwk = method.publicKeyJwk;
          if (jwk.crv !== 'secp256k1' || !jwk.x || !jwk.y) {
            throw new Error('Invalid JWK for ES256K');
          }
          const x = fromString(jwk.x, 'base64url');
          const y = fromString(jwk.y, 'base64url');
          publicKeyBytes = concat([new Uint8Array([0x04]), x, y]);
        } else if (method.publicKeyMultibase) {
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

        const verified = verifyEs256kSig(
          publicKeyBytes,
          signingInput,
          signature
        );
        if (!verified) {
          throw new Error('ES256K signature verification failed');
        }
      } else if (header.alg === 'ES256') {
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
      } else {
        throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
      }

      console.log('[AUTH] ✓ Signature verified for DID: %s', signingDid);
      return true;
    } catch (error) {
      console.error(
        `[AUTH] Signature verification failed for DID ${signingDid}:`,
        error
      );
      return false;
    }
  }

  /**
   * Verify either local session token OR AT Protocol access token
   */
  async verifyToken(
    token: string
  ): Promise<{ did: string; sessionId?: string } | null> {
    // Try local session token first (faster path for our own web UI)
    const sessionPayload = this.verifySessionToken(token);
    if (sessionPayload) {
      console.log(
        `[AUTH] ✓ Local session token verified for DID: ${sessionPayload.did}`
      );
      return sessionPayload;
    }

    // Try AT Protocol access token (for third-party clients)
    const atProtoPayload = await this.verifyAtProtoToken(token);
    if (atProtoPayload) {
      return atProtoPayload;
    }

    return null;
  }

  generateSessionId(): string {
    return randomBytes(32).toString('hex');
  }

  extractToken(req: Request): string | null {
    // 1. Check for cookie first (for web UI sessions)
    if (req.cookies && req.cookies.auth_token) {
      console.log('[AUTH] Extracted token from cookie for %s', req.path);
      return req.cookies.auth_token;
    }

    // 2. Fallback to Bearer token for API clients
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }
}

export const authService = new AuthService();

export interface AuthRequest extends Request {
  session?: SessionPayload;
}

/**
 * Validates a session by its ID, refreshing the PDS access token if it has expired.
 * This is a centralized function to be used by all authenticated routes/middleware.
 * @returns The updated session object, or null if the session is invalid.
 */
export async function validateAndRefreshSession(sessionId: string) {
  const { storage } = await import('../storage');
  let session = await storage.getSession(sessionId);

  if (!session) {
    return null; // Session not found in the database
  }

  const now = new Date();
  if (now > new Date(session.expiresAt)) {
    if (session.refreshToken) {
      console.log(
        `[AUTH] Access token expired for ${session.userDid}, attempting refresh...`
      );

      const { pdsClient } = await import('./pds-client');
      const { didResolver } = await import('./did-resolver');

      const pdsEndpoint = await didResolver.resolveDIDToPDS(session.userDid);
      if (pdsEndpoint) {
        const refreshResult = await pdsClient.refreshAccessToken(
          pdsEndpoint,
          session.refreshToken
        );

        if (refreshResult.success && refreshResult.data) {
          const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
          const updatedSessionData = {
            accessToken: refreshResult.data.accessJwt,
            refreshToken: refreshResult.data.refreshJwt || session.refreshToken,
            expiresAt: newExpiresAt,
          };

          session = await storage.updateSession(sessionId, updatedSessionData);
          if (session) {
            console.log(
              `[AUTH] Successfully refreshed and updated session for ${session.userDid}`
            );
            return session;
          }
        }
      }

      // If refresh fails for any reason, delete the invalid session
      await storage.deleteSession(sessionId);
      return null;
    } else {
      // No refresh token, so the session is permanently expired
      await storage.deleteSession(sessionId);
      return null;
    }
  }

  // Session is valid and not expired
  return session;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const token = authService.extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No authentication token provided' });
  }

  // Use verifyToken to support both local session tokens AND AT Protocol access tokens
  const payload = await authService.verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Use the centralized session validation and refresh logic
  if (payload.sessionId) {
    const session = await validateAndRefreshSession(payload.sessionId);
    if (!session) {
      return res
        .status(401)
        .json({ error: 'Session not found or has expired' });
    }
  }

  req.session = payload as SessionPayload; // Attach original payload with DID and sessionID to the request
  next();
}

export async function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  await requireAuth(req, res, async () => {
    if (!req.session) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { adminAuthService } = await import('./admin-authorization');
    const isAdmin = await adminAuthService.isAdmin(req.session.did);

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Admin access required',
        message:
          'Your account is not authorized to access admin features. Contact your instance administrator.',
      });
    }

    next();
  });
}
