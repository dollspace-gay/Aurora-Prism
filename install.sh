#!/bin/bash

# Aurora Prism - One-Step Interactive Setup Script
# This script handles all setup: key generation, DID configuration, and Docker deployment
#
# Prerequisites: Docker, Docker Compose, and DNS configured
# Dependencies: openssl, jq, xxd, bs58

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                                                                ║${NC}"
echo -e "${CYAN}║           🌈 Aurora Prism - Interactive Setup 🌈               ║${NC}"
echo -e "${CYAN}║                                                                ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# --- Dependency Check ---
echo -e "${BLUE}[1/6] Checking dependencies...${NC}"
MISSING_DEPS=()
for cmd in docker docker-compose openssl jq xxd bs58; do
  if ! command -v $cmd &> /dev/null; then
    MISSING_DEPS+=("$cmd")
  fi
done

if [ ${#MISSING_DEPS[@]} -ne 0 ]; then
  echo -e "${RED}❌ Missing required dependencies: ${MISSING_DEPS[*]}${NC}"
  echo ""
  echo "Install missing dependencies:"
  echo "  Ubuntu/Debian: sudo apt-get install openssl jq xxd python3-pip && pip3 install base58"
  echo "  macOS: brew install openssl jq xxd && pip3 install base58"
  echo ""
  exit 1
fi
echo -e "${GREEN}✅ All dependencies found${NC}"
echo ""

# --- Configuration Prompts ---
echo -e "${BLUE}[2/6] Configuration${NC}"
echo ""

# Domain/DID
echo -e "${YELLOW}Enter your domain (e.g., appview.yourdomain.com):${NC}"
read -p "> " DOMAIN
DOMAIN=$(echo "$DOMAIN" | sed 's|^https\?://||' | sed 's|/$||')
APPVIEW_DID="did:web:${DOMAIN}"
echo -e "${GREEN}✅ Will use DID: ${APPVIEW_DID}${NC}"
echo ""

# Docker image choice
echo -e "${YELLOW}Use pre-built Docker images from GHCR? (faster, recommended)${NC}"
echo "  1) Yes - Use latest stable release (ghcr.io/dollspace-gay/aurora-prism:latest)"
echo "  2) No  - Build from source locally"
read -p "> " IMAGE_CHOICE
if [[ "$IMAGE_CHOICE" == "1" ]]; then
  USE_PREBUILT=true
  AURORA_PRISM_IMAGE="ghcr.io/dollspace-gay/aurora-prism:latest"
  echo -e "${GREEN}✅ Will use pre-built images${NC}"
else
  USE_PREBUILT=false
  echo -e "${GREEN}✅ Will build from source${NC}"
fi
echo ""

# Session secret
echo -e "${YELLOW}Generating secure session secret...${NC}"
SESSION_SECRET=$(openssl rand -base64 32)
echo -e "${GREEN}✅ Session secret generated${NC}"
echo ""

# Optional: Backfill
echo -e "${YELLOW}Enable automatic backfill on startup?${NC}"
echo "  0) No backfill (default)"
echo "  7) Last 7 days"
echo "  30) Last 30 days"
echo "  -1) Full history (WARNING: slow, resource-intensive)"
read -p "> " BACKFILL_DAYS
BACKFILL_DAYS=${BACKFILL_DAYS:-0}
echo -e "${GREEN}✅ Backfill: ${BACKFILL_DAYS} days${NC}"
echo ""

# Optional: Data retention
echo -e "${YELLOW}Data retention (days to keep data, 0 = keep forever):${NC}"
read -p "> " DATA_RETENTION_DAYS
DATA_RETENTION_DAYS=${DATA_RETENTION_DAYS:-0}
echo -e "${GREEN}✅ Data retention: ${DATA_RETENTION_DAYS} days${NC}"
echo ""

# --- OAuth Key Generation ---
echo -e "${BLUE}[3/6] Generating OAuth keys (ES256 P-256)...${NC}"

# Generate P-256 key for OAuth
openssl ecparam -name prime256v1 -genkey -noout -out private-legacy.pem
openssl pkcs8 -topk8 -nocrypt -in private-legacy.pem -out private-pkcs8.pem
openssl ec -in private-legacy.pem -pubout -out public.pem 2>/dev/null

PRIVATE_KEY_PEM=$(cat private-pkcs8.pem)
PUBLIC_KEY_PEM=$(cat public.pem)

# Extract components for JWK
KEY_COMPONENTS_HEX=$(openssl ec -in private-legacy.pem -text -noout)
PRIV_HEX=$(echo "$KEY_COMPONENTS_HEX" | grep priv -A 3 | tail -n +2 | tr -d ' \n:')
PUB_HEX=$(echo "$KEY_COMPONENTS_HEX" | grep pub -A 5 | tail -n +2 | tr -d ' \n:')
X_HEX=$(echo "$PUB_HEX" | cut -c 3-66)
Y_HEX=$(echo "$PUB_HEX" | cut -c 67-130)

D_B64URL=$(echo -n "$PRIV_HEX" | xxd -r -p | base64 | tr '/+' '_-' | tr -d '=')
X_B64URL=$(echo -n "$X_HEX" | xxd -r -p | base64 | tr '/+' '_-' | tr -d '=')
Y_B64URL=$(echo -n "$Y_HEX" | xxd -r -p | base64 | tr '/+' '_-' | tr -d '=')

KID="$(date +%s)-$(openssl rand -hex 4)"

# Create oauth-keyset.json
jq -n \
  --arg kid "$KID" \
  --arg pkpem "$PRIVATE_KEY_PEM" \
  --arg pubpem "$PUBLIC_KEY_PEM" \
  --arg d "$D_B64URL" \
  --arg x "$X_B64URL" \
  --arg y "$Y_B64URL" \
  '{
    kid: $kid,
    privateKeyPem: $pkpem,
    publicKeyPem: $pubpem,
    jwk: {
      kid: $kid,
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      use: "sig",
      d: $d,
      x: $x,
      y: $y
    }
  }' > oauth-keyset.json

rm private-legacy.pem private-pkcs8.pem public.pem

echo -e "${GREEN}✅ oauth-keyset.json created${NC}"
echo ""

# --- AppView Signing Key Generation ---
echo -e "${BLUE}[4/6] Generating AppView signing keys (ES256K secp256k1)...${NC}"

# Generate secp256k1 key for AppView signing
openssl ecparam -name secp256k1 -genkey -noout -out appview-private.pem

# Extract public key for DID document
RAW_PUBKEY=$(openssl ec -in appview-private.pem -pubout -outform DER 2>/dev/null | tail -c 65)
PREFIXED_KEY=$(printf '\xe7\x01' && echo -n "$RAW_PUBKEY")
PUBLIC_KEY_MULTIBASE=$(echo -n "$PREFIXED_KEY" | bs58)

# Extract components for JWK
KEY_COMPONENTS_HEX=$(openssl ec -in appview-private.pem -text -noout 2>/dev/null)
PRIV_HEX=$(echo "$KEY_COMPONENTS_HEX" | grep priv -A 3 | tail -n +2 | tr -d ' \n:')
PUB_HEX=$(echo "$KEY_COMPONENTS_HEX" | grep pub -A 5 | tail -n +2 | tr -d ' \n:')
X_HEX=$(echo $PUB_HEX | cut -c 3-66)
Y_HEX=$(echo $PUB_HEX | cut -c 67-130)

D_B64URL=$(echo -n $PRIV_HEX | xxd -r -p | base64 | tr '/+' '_-' | tr -d '=')
X_B64URL=$(echo -n $X_HEX | xxd -r -p | base64 | tr '/+' '_-' | tr -d '=')
Y_B64URL=$(echo -n $Y_HEX | xxd -r -p | base64 | tr '/+' '_-' | tr -d '=')

KID="$(date +%s)-$(openssl rand -hex 4)"

# Create did.json
mkdir -p public
jq -n \
  --arg id "$APPVIEW_DID" \
  --arg domain "$DOMAIN" \
  --arg pubkey "$PUBLIC_KEY_MULTIBASE" \
  '{
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1"
    ],
    "id": $id,
    "alsoKnownAs": ["at://\($domain)"],
    "verificationMethod": [
      {
        "id": "\($id)#atproto",
        "type": "Multikey",
        "controller": $id,
        "publicKeyMultibase": $pubkey
      }
    ],
    "service": [
      {
        "id": "#bsky_notif",
        "type": "BskyNotificationService",
        "serviceEndpoint": "https://\($domain)"
      },
      {
        "id": "#bsky_appview",
        "type": "BskyAppView",
        "serviceEndpoint": "https://\($domain)"
      }
    ]
  }' > public/did.json

# Create appview-signing-key.json
jq -n \
  --arg kid "$KID" \
  --arg d "$D_B64URL" \
  --arg x "$X_B64URL" \
  --arg y "$Y_B64URL" \
  '{
    kid: $kid,
    kty: "EC",
    crv: "secp256k1",
    alg: "ES256K",
    use: "sig",
    d: $d,
    x: $x,
    y: $y
  }' > appview-signing-key.json

echo -e "${GREEN}✅ appview-signing-key.json created${NC}"
echo -e "${GREEN}✅ appview-private.pem created${NC}"
echo -e "${GREEN}✅ public/did.json created${NC}"
echo ""

# --- .env File Generation ---
echo -e "${BLUE}[5/6] Creating .env configuration file...${NC}"

cat > .env <<EOF
# Aurora Prism Configuration
# Generated by setup.sh on $(date)

# Docker Images
$(if [ "$USE_PREBUILT" = true ]; then
  echo "AURORA_PRISM_IMAGE=${AURORA_PRISM_IMAGE}"
  echo "PYTHON_FIREHOSE_IMAGE=ghcr.io/dollspace-gay/aurora-prism/python-firehose:latest"
  echo "PYTHON_WORKER_IMAGE=ghcr.io/dollspace-gay/aurora-prism/python-worker:latest"
  echo "PYTHON_BACKFILL_WORKER_IMAGE=ghcr.io/dollspace-gay/aurora-prism/python-backfill-worker:latest"
  echo "CONSTELLATION_BRIDGE_IMAGE=ghcr.io/dollspace-gay/aurora-prism/constellation-bridge:latest"
else
  echo "# AURORA_PRISM_IMAGE=aurora-prism:local"
  echo "# PYTHON_FIREHOSE_IMAGE=aurora-prism/python-firehose:local"
  echo "# PYTHON_WORKER_IMAGE=aurora-prism/python-worker:local"
  echo "# PYTHON_BACKFILL_WORKER_IMAGE=aurora-prism/python-backfill-worker:local"
  echo "# CONSTELLATION_BRIDGE_IMAGE=aurora-prism/constellation-bridge:local"
fi)

# AppView Identity
APPVIEW_DID=${APPVIEW_DID}
SESSION_SECRET=${SESSION_SECRET}

# Backfill Configuration
BACKFILL_DAYS=${BACKFILL_DAYS}

# Data Retention
DATA_RETENTION_DAYS=${DATA_RETENTION_DAYS}

# Optional Features (disabled by default)
CONSTELLATION_ENABLED=false
OSPREY_ENABLED=false

# Advanced Settings (defaults are usually fine)
# RELAY_URL=wss://bsky.network
# DB_POOL_SIZE=200
# MAX_CONCURRENT_OPS=100
EOF

echo -e "${GREEN}✅ .env file created${NC}"
echo ""

# Set secure permissions
chmod 600 oauth-keyset.json appview-signing-key.json appview-private.pem
chmod 644 public/did.json

echo -e "${GREEN}✅ Secure file permissions set${NC}"
echo ""

# --- Docker Deployment ---
echo -e "${BLUE}[6/6] Starting Aurora Prism with Docker Compose...${NC}"
echo ""

if [ "$USE_PREBUILT" = true ]; then
  echo -e "${YELLOW}Pulling pre-built images...${NC}"
  docker pull "${AURORA_PRISM_IMAGE}"
  docker pull "ghcr.io/dollspace-gay/aurora-prism/python-firehose:latest"
  docker pull "ghcr.io/dollspace-gay/aurora-prism/python-worker:latest"
  docker pull "ghcr.io/dollspace-gay/aurora-prism/python-backfill-worker:latest"
  docker pull "ghcr.io/dollspace-gay/aurora-prism/constellation-bridge:latest"
fi

echo -e "${YELLOW}Starting services...${NC}"
docker-compose up -d

echo ""
echo -e "${GREEN}✅ Aurora Prism is starting up!${NC}"
echo ""

# Wait for health checks
echo -e "${YELLOW}Waiting for services to become healthy (this may take 30-60 seconds)...${NC}"
sleep 10

# Check status
echo ""
docker-compose ps

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                                                                ║${NC}"
echo -e "${CYAN}║                    🎉 Setup Complete! 🎉                       ║${NC}"
echo -e "${CYAN}║                                                                ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✅ Aurora Prism is running at: http://localhost:5000${NC}"
echo ""
echo -e "${YELLOW}📋 Next Steps:${NC}"
echo ""
echo -e "${BLUE}1. Deploy DID document to your domain:${NC}"
echo -e "   Upload ${GREEN}public/did.json${NC} to ${CYAN}https://${DOMAIN}/.well-known/did.json${NC}"
echo ""
echo -e "${BLUE}2. Verify DID deployment:${NC}"
echo -e "   ${CYAN}curl https://${DOMAIN}/.well-known/did.json${NC}"
echo ""
echo -e "${BLUE}3. Access your Aurora Prism dashboard:${NC}"
echo -e "   ${CYAN}http://localhost:5000${NC}"
echo ""
echo -e "${BLUE}4. Login with your Bluesky credentials${NC}"
echo ""
echo -e "${YELLOW}📁 Important Files (keep these secure):${NC}"
echo -e "   🔒 ${RED}oauth-keyset.json${NC} - OAuth signing key (DO NOT COMMIT)"
echo -e "   🔒 ${RED}appview-signing-key.json${NC} - AppView signing key (DO NOT COMMIT)"
echo -e "   🔒 ${RED}appview-private.pem${NC} - AppView private key (DO NOT COMMIT)"
echo -e "   🔒 ${RED}.env${NC} - Environment configuration (DO NOT COMMIT)"
echo -e "   📄 ${GREEN}public/did.json${NC} - Public DID document (safe to commit)"
echo ""
echo -e "${YELLOW}🔧 Useful Commands:${NC}"
echo -e "   View logs:        ${CYAN}docker-compose logs -f${NC}"
echo -e "   Stop services:    ${CYAN}docker-compose down${NC}"
echo -e "   Restart services: ${CYAN}docker-compose restart${NC}"
echo -e "   Check status:     ${CYAN}docker-compose ps${NC}"
echo ""
echo -e "${BLUE}📚 Documentation:${NC}"
echo -e "   README.md, DEPLOY.md, PRODUCTION_DEPLOYMENT.md"
echo ""
