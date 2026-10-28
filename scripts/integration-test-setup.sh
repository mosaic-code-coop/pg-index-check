#!/bin/bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo -e "${GREEN}🚀 Setting up integration test environment (PostgreSQL ${POSTGRES_VERSION:-18})...${NC}"

# 1. Start docker compose (POSTGRES_VERSION selects the image, default 18)
echo -e "${YELLOW}📦 Starting PostgreSQL container...${NC}"
if ! docker compose up -d postgres-test 2>/dev/null; then
    echo -e "${RED}❌ Failed to start docker compose. Ensure docker is running.${NC}"
    echo -e "${YELLOW}💡 Try: docker compose up -d${NC}"
    exit 1
fi

# 2. Wait for database to be healthy
echo -e "${YELLOW}⏳ Waiting for database to be ready...${NC}"
MAX_WAIT=30
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if docker compose exec -T postgres-test pg_isready -U test >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Database is ready!${NC}"
        break
    fi
    sleep 1
    WAITED=$((WAITED + 1))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${RED}❌ Database did not become ready within ${MAX_WAIT} seconds.${NC}"
    echo -e "${YELLOW}💡 Check logs with: docker compose logs postgres-test${NC}"
    exit 1
fi

# 3. Run integration tests
echo -e "${GREEN}🧪 Running integration tests...${NC}"
if ! npm run test:integration; then
    echo -e "${RED}❌ Integration tests failed.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All integration tests passed!${NC}"

echo ""
echo -e "${YELLOW}💡 Database container is still running.${NC}"
echo -e "${YELLOW}💡 Stop it with: docker compose down${NC}"
