# On-Demand PDS Backfill

This feature allows your AppView to automatically fetch users from independent PDS instances that aren't federated to Bluesky's relay.

## How It Works

### Automatic Backfill
When a user tries to view a profile that doesn't exist in your AppView:
1. The system detects the 404
2. Resolves the user's DID to find their PDS (via plc.directory)
3. Fetches their profile and recent content directly from their PDS
4. Indexes it into your AppView
5. Future requests will return the cached data

### Manual Backfill (Admin Panel)
You can also manually trigger backfills via the admin API:

```bash
# Trigger backfill for a specific DID
curl -X POST https://your-appview.com/api/admin/backfill/pds \
  -H "Content-Type: application/json" \
  -d '{"did": "did:plc:63hvnyjvqi2nzzcsjgnry5we"}'

# Check backfill status
curl https://your-appview.com/api/admin/backfill/pds/status
```

## Example: Backfilling spacelawshitpost.me

The user `spacelawshitpost.me` is on blacksky.app PDS and isn't in Bluesky's relay.

### Automatic Method
Just try to view their profile in your AppView:
```
GET /xrpc/app.bsky.actor.getProfile?actor=did:plc:63hvnyjvqi2nzzcsjgnry5we
```

First request: Returns 404 with message "Attempting to fetch from their PDS"
Wait 5-10 seconds, then retry
Second request: Returns full profile!

### Manual Method
```bash
curl -X POST https://appview.dollspace.gay/api/admin/backfill/pds \
  -H "Content-Type: application/json" \
  -d '{"did": "did:plc:63hvnyjvqi2nzzcsjgnry5we"}'
```

## Rate Limiting

- **Cooldown**: 5 minutes per DID (won't re-backfill the same user more frequently)
- **Record Limit**: Maximum 1000 records per collection (prevents abuse)

## Collections Backfilled

When a user is backfilled, the system fetches:
- `app.bsky.actor.profile` - Profile info
- `app.bsky.feed.post` - Posts
- `app.bsky.feed.like` - Likes
- `app.bsky.feed.repost` - Reposts
- `app.bsky.graph.follow` - Follows
- `app.bsky.graph.block` - Blocks
- And any other collections the PDS returns

## Monitoring

Check the server logs for backfill progress:
```
[ON_DEMAND_BACKFILL] Starting backfill for did:plc:...
[ON_DEMAND_BACKFILL] did:plc:... is on PDS: blacksky.app
[ON_DEMAND_BACKFILL] Backfilling spacelawshitpost.me from blacksky.app
[ON_DEMAND_BACKFILL] Collections: app.bsky.actor.profile, app.bsky.feed.post, ...
[ON_DEMAND_BACKFILL] Backfilled 42 records from app.bsky.feed.post
[ON_DEMAND_BACKFILL] Completed backfill for did:plc:...
```

## Why Is This Needed?

Some users are on independent PDS instances that:
1. Aren't federated to Bluesky's main relay
2. Require authentication for firehose access
3. Are on relays that are currently offline (like atproto.africa)

This on-demand system ensures your AppView can still serve these users when requested, without continuously polling or maintaining permanent connections to every independent PDS.
