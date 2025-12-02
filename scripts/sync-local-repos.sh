#!/bin/bash
# Sync Memex updates to all local Cirrus repositories
# This script pulls the latest Memex from DevOps repo and updates all local repos

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MEMEX_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"
CIRRUS_BASE_DIR="${CIRRUS_BASE_DIR:-$HOME/code/cirrus}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🔄 Memex Local Repo Sync${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Step 1: Pull latest Memex from DevOps repo
echo -e "${YELLOW}📥 Step 1: Pulling latest Memex from DevOps/main...${NC}"
cd "$MEMEX_PATH/.."
if git pull origin main; then
  echo -e "${GREEN}  ✅ DevOps repo updated${NC}"
else
  echo -e "${RED}  ⚠️  Failed to pull DevOps repo${NC}"
  exit 1
fi
echo ""

# Step 2: Find all local Cirrus repositories
echo -e "${YELLOW}📂 Step 2: Finding local Cirrus repositories...${NC}"
if [ ! -d "$CIRRUS_BASE_DIR" ]; then
  echo -e "${RED}  ⚠️  Cirrus base directory not found: $CIRRUS_BASE_DIR${NC}"
  echo "  Set CIRRUS_BASE_DIR environment variable to your repos location"
  exit 1
fi

# Find all git repos in the Cirrus directory (excluding DevOps itself)
REPOS=()
for dir in "$CIRRUS_BASE_DIR"/*; do
  if [ -d "$dir/.git" ]; then
    repo_name=$(basename "$dir")
    if [ "$repo_name" != "DevOps" ]; then
      REPOS+=("$dir")
    fi
  fi
done

if [ ${#REPOS[@]} -eq 0 ]; then
  echo -e "${YELLOW}  No repositories found in $CIRRUS_BASE_DIR${NC}"
  exit 0
fi

echo -e "${GREEN}  Found ${#REPOS[@]} repositories${NC}"
for repo in "${REPOS[@]}"; do
  echo "    - $(basename "$repo")"
done
echo ""

# Step 3: Update Memex in each repository
echo -e "${YELLOW}📤 Step 3: Updating Memex in each repository...${NC}"
echo ""

updated_count=0
skipped_count=0
error_count=0

for repo in "${REPOS[@]}"; do
  repo_name=$(basename "$repo")
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}📦 $repo_name${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  # Check if .claude directory exists
  if [ ! -d "$repo/.claude" ]; then
    echo -e "${YELLOW}  ⚠️  No .claude directory found, skipping...${NC}"
    ((skipped_count++))
    echo ""
    continue
  fi

  # Check if Memex is already set up
  if [ ! -f "$repo/.claude/MEMEX.md" ] && [ ! -f "$repo/.claude/hooks/on-start.sh" ]; then
    echo -e "${YELLOW}  ⚠️  Memex not set up in this repo, skipping...${NC}"
    echo "  (Run deploy-to-all-repos.sh to set up Memex first)"
    ((skipped_count++))
    echo ""
    continue
  fi

  # Create .claude/hooks if it doesn't exist
  mkdir -p "$repo/.claude/hooks"

  # Copy latest files from template
  echo "  1. Copying latest MEMEX.md..."
  if cp "$MEMEX_PATH/templates/.claude/MEMEX.md" "$repo/.claude/"; then
    echo -e "${GREEN}     ✓ MEMEX.md updated${NC}"
  else
    echo -e "${RED}     ✗ Failed to copy MEMEX.md${NC}"
    ((error_count++))
    echo ""
    continue
  fi

  echo "  2. Copying latest on-start.sh hook..."
  if cp "$MEMEX_PATH/templates/.claude/hooks/on-start.sh" "$repo/.claude/hooks/"; then
    chmod +x "$repo/.claude/hooks/on-start.sh"
    echo -e "${GREEN}     ✓ on-start.sh updated${NC}"
  else
    echo -e "${RED}     ✗ Failed to copy on-start.sh${NC}"
    ((error_count++))
    echo ""
    continue
  fi

  # Check if there are changes to commit
  cd "$repo"
  if git diff --quiet .claude/; then
    echo -e "${YELLOW}  ℹ️  No changes detected${NC}"
    ((skipped_count++))
  else
    echo "  3. Changes detected, ready to commit"
    echo -e "${GREEN}  ✅ Updated successfully${NC}"
    ((updated_count++))

    # Show what changed
    echo ""
    echo "  📝 Changed files:"
    git diff --name-only .claude/ | sed 's/^/     - /'
    echo ""
    echo -e "${YELLOW}  💡 Review changes with: cd $repo && git diff .claude/${NC}"
    echo -e "${YELLOW}  💡 Commit changes with: cd $repo && git add .claude/ && git commit -m 'chore(claude): update Memex to v2.0'${NC}"
  fi

  echo ""
  cd - > /dev/null
done

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📊 Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Total repositories processed: ${#REPOS[@]}"
echo -e "  ${GREEN}✅ Updated: $updated_count${NC}"
echo -e "  ${YELLOW}⊘  Skipped: $skipped_count${NC}"
if [ $error_count -gt 0 ]; then
  echo -e "  ${RED}✗  Errors: $error_count${NC}"
fi
echo ""

if [ $updated_count -gt 0 ]; then
  echo -e "${YELLOW}📝 Next Steps:${NC}"
  echo "  1. Review changes in each updated repository"
  echo "  2. Commit and push changes to share with team"
  echo ""
  echo -e "${BLUE}  Quick commit all:${NC}"
  echo "    for repo in $CIRRUS_BASE_DIR/*/; do"
  echo "      cd \"\$repo\" && git add .claude/ && git commit -m 'chore(claude): update Memex to v2.0' && git push || true"
  echo "    done"
  echo ""
fi

echo -e "${GREEN}✅ Sync complete!${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
