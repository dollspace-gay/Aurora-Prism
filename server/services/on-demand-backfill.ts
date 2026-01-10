import { logCollector } from './log-collector';
import { redisQueue } from './redis-queue';
import { metricsService } from './metrics';

interface BackfillJob {
  did: string;
  pdsUrl: string;
  timestamp: number;
}

export class OnDemandBackfill {
  private activeJobs: Map<string, BackfillJob> = new Map();
  private recentlyBackfilled: Set<string> = new Set();
  private readonly BACKFILL_COOLDOWN = 5 * 60 * 1000; // Don't re-backfill same DID for 5 minutes

  /**
   * Backfill a user from their PDS when they're not found in our AppView
   */
  async backfillUser(did: string): Promise<boolean> {
    // Check if we're already backfilling this DID
    if (this.activeJobs.has(did)) {
      console.log(`[ON_DEMAND_BACKFILL] Already backfilling ${did}`);
      return false;
    }

    // Check cooldown - don't spam backfill the same user
    if (this.recentlyBackfilled.has(did)) {
      console.log(`[ON_DEMAND_BACKFILL] ${did} recently backfilled, skipping`);
      return false;
    }

    try {
      console.log(`[ON_DEMAND_BACKFILL] Starting backfill for ${did}`);
      logCollector.info(`On-demand backfill started for ${did}`);

      // First, resolve the DID to find their PDS
      const pdsUrl = await this.resolvePDS(did);

      if (!pdsUrl) {
        console.warn(`[ON_DEMAND_BACKFILL] Could not resolve PDS for ${did}`);
        return false;
      }

      console.log(`[ON_DEMAND_BACKFILL] ${did} is on PDS: ${pdsUrl}`);

      // Mark as active
      this.activeJobs.set(did, {
        did,
        pdsUrl,
        timestamp: Date.now(),
      });

      // Perform the backfill
      await this.performBackfill(did, pdsUrl);

      // Mark as recently backfilled (with cooldown)
      this.recentlyBackfilled.add(did);
      setTimeout(() => {
        this.recentlyBackfilled.delete(did);
      }, this.BACKFILL_COOLDOWN);

      // Remove from active jobs
      this.activeJobs.delete(did);

      console.log(`[ON_DEMAND_BACKFILL] Completed backfill for ${did}`);
      logCollector.success(`On-demand backfill completed for ${did}`);

      return true;
    } catch (error) {
      console.error(`[ON_DEMAND_BACKFILL] Error backfilling ${did}:`, error);
      logCollector.error(`On-demand backfill failed for ${did}`, { error });
      this.activeJobs.delete(did);
      metricsService.incrementError();
      return false;
    }
  }

  private async resolvePDS(did: string): Promise<string | null> {
    try {
      // Fetch DID document from PLC directory
      const plcUrl = `https://plc.directory/${did}`;
      const response = await fetch(plcUrl);

      if (!response.ok) {
        console.warn(
          `[ON_DEMAND_BACKFILL] Failed to resolve DID ${did}: ${response.status}`
        );
        return null;
      }

      const didDoc = await response.json();

      // Extract PDS service endpoint
      const pdsService = didDoc.service?.find(
        (s: { type?: string; serviceEndpoint?: string }) =>
          s.type === 'AtprotoPersonalDataServer'
      );

      if (!pdsService?.serviceEndpoint) {
        console.warn(
          `[ON_DEMAND_BACKFILL] No PDS service found in DID document for ${did}`
        );
        return null;
      }

      // Remove https:// prefix to get just the hostname
      const pdsUrl = pdsService.serviceEndpoint.replace(/^https?:\/\//, '');

      return pdsUrl;
    } catch (error) {
      console.error(
        `[ON_DEMAND_BACKFILL] Error resolving PDS for ${did}:`,
        error
      );
      return null;
    }
  }

  private async performBackfill(did: string, pdsUrl: string) {
    try {
      // First, get repo description
      const describeUrl = `https://${pdsUrl}/xrpc/com.atproto.repo.describeRepo?repo=${did}`;
      const describeResponse = await fetch(describeUrl);

      if (!describeResponse.ok) {
        throw new Error(`Failed to describe repo: ${describeResponse.status}`);
      }

      const describeData = await describeResponse.json();
      const handle = describeData.handle;
      const collections = describeData.collections || [];

      console.log(
        `[ON_DEMAND_BACKFILL] Backfilling ${handle} (${did}) from ${pdsUrl}`
      );
      console.log(
        `[ON_DEMAND_BACKFILL] Collections: ${collections.join(', ')}`
      );

      // Process handle/identity first
      await redisQueue.push({
        type: 'identity',
        data: {
          did: did,
          handle: handle,
        },
      });

      metricsService.incrementEvent('#identity');

      // Backfill each collection
      for (const collection of collections) {
        await this.backfillCollection(did, pdsUrl, collection);
      }

      console.log(`[ON_DEMAND_BACKFILL] Backfilled all collections for ${did}`);
    } catch (error) {
      console.error(`[ON_DEMAND_BACKFILL] Error during backfill:`, error);
      throw error;
    }
  }

  private async backfillCollection(
    did: string,
    pdsUrl: string,
    collection: string
  ) {
    try {
      let cursor: string | undefined = undefined;
      let totalRecords = 0;

      do {
        // Fetch records from this collection
        const listUrl: string = `https://${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=${collection}&limit=100${cursor ? `&cursor=${cursor}` : ''}`;
        const response: Response = await fetch(listUrl);

        if (!response.ok) {
          if (response.status === 400) {
            // Collection doesn't exist, skip it
            return;
          }
          throw new Error(`Failed to list ${collection}: ${response.status}`);
        }

        const data: {
          records?: { uri: string; cid: string; value: unknown }[];
          cursor?: string;
        } = await response.json();
        const records = data.records || [];

        if (records.length === 0) {
          break;
        }

        // Process each record
        for (const record of records) {
          const path = record.uri.split('/').slice(-2).join('/'); // collection/rkey

          const commit = {
            repo: did,
            ops: [
              {
                action: 'create',
                path: path,
                cid: record.cid,
                record: record.value,
              },
            ],
          };

          // Push to Redis queue for processing
          await redisQueue.push({
            type: 'commit',
            data: commit,
            seq: undefined,
          });

          metricsService.incrementEvent('#commit');
          totalRecords++;
        }

        cursor = data.cursor;

        // Don't backfill more than 1000 records per collection (prevent abuse)
        if (totalRecords >= 1000) {
          console.log(
            `[ON_DEMAND_BACKFILL] Reached limit of 1000 records for ${collection}, stopping`
          );
          break;
        }
      } while (cursor);

      if (totalRecords > 0) {
        console.log(
          `[ON_DEMAND_BACKFILL] Backfilled ${totalRecords} records from ${collection}`
        );
      }
    } catch (error) {
      console.error(
        `[ON_DEMAND_BACKFILL] Error backfilling collection ${collection}:`,
        error
      );
      throw error;
    }
  }

  getStatus() {
    return {
      activeJobs: Array.from(this.activeJobs.values()),
      recentlyBackfilled: this.recentlyBackfilled.size,
      cooldownMs: this.BACKFILL_COOLDOWN,
    };
  }
}

export const onDemandBackfill = new OnDemandBackfill();
