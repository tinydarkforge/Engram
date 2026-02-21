#!/usr/bin/env bash
# TheDarkFactory Project Scaffold
# Usage: ./scaffold-project.sh <project-name> [--public]
#
# Creates a new project with the standard TheDarkFactory structure:
# - GitHub repo (private by default)
# - SPEC.md template
# - .claude/CLAUDE.md template
# - .github/workflows/ci.yml
# - .mcp.json (Memex integration)
# - README.md template
# - Standard .gitignore
# - GitHub labels

set -euo pipefail

TEMPLATE_DIR="$(dirname "$0")/../docs/templates"
ORG="TheDarkFactory"
BASE_DIR="$HOME/code/$ORG"

# Parse arguments
PROJECT_NAME="${1:-}"
VISIBILITY="--private"

if [ -z "$PROJECT_NAME" ]; then
  echo "Usage: $0 <project-name> [--public]"
  echo ""
  echo "Creates a new TheDarkFactory project with standard scaffold."
  exit 1
fi

if [ "${2:-}" = "--public" ]; then
  VISIBILITY="--public"
fi

PROJECT_DIR="$BASE_DIR/$PROJECT_NAME"

echo "=== TheDarkFactory Project Scaffold ==="
echo "Project: $PROJECT_NAME"
echo "Directory: $PROJECT_DIR"
echo "Visibility: ${VISIBILITY#--}"
echo ""

# Check if directory already exists
if [ -d "$PROJECT_DIR" ]; then
  echo "ERROR: Directory $PROJECT_DIR already exists."
  exit 1
fi

# Create GitHub repo and clone
echo "[1/8] Creating GitHub repo..."
gh repo create "$ORG/$PROJECT_NAME" "$VISIBILITY" --clone
cd "$PROJECT_DIR"

# Create directory structure
echo "[2/8] Creating directory structure..."
mkdir -p .claude/commands
mkdir -p .github/workflows
mkdir -p docs
mkdir -p scripts
mkdir -p tests
mkdir -p src

# Copy templates
echo "[3/8] Copying templates..."
cp "$TEMPLATE_DIR/SPEC-TEMPLATE.md" SPEC.md
cp "$TEMPLATE_DIR/CLAUDE-TEMPLATE.md" .claude/CLAUDE.md
cp "$TEMPLATE_DIR/ci-node.yml" .github/workflows/ci.yml
cp "$TEMPLATE_DIR/README-TEMPLATE.md" README.md
cp "$TEMPLATE_DIR/mcp-template.json" .mcp.json
cp "$TEMPLATE_DIR/PULL_REQUEST_TEMPLATE.md" .github/PULL_REQUEST_TEMPLATE.md

# Create .gitignore
echo "[4/8] Creating .gitignore..."
cat > .gitignore << 'GITIGNORE'
node_modules/
.DS_Store
.env
*.db
*.db-journal
dist/
.cache/
.vercel/
GITIGNORE

# Create .env.example
echo "[5/8] Creating .env.example..."
cat > .env.example << 'ENVEXAMPLE'
# Copy this file to .env and fill in values
# cp .env.example .env

# DATABASE_URL=postgresql://user:pass@host:5432/dbname
# JWT_SECRET=generate-with-openssl-rand-base64-32
ENVEXAMPLE

# Replace placeholders in templates
echo "[6/8] Customizing templates..."
if command -v sed &> /dev/null; then
  sed -i '' "s/\[Project Name\]/$PROJECT_NAME/g" SPEC.md README.md .claude/CLAUDE.md 2>/dev/null || true
  sed -i '' "s/\[DATE\]/$(date +%Y-%m-%d)/g" .claude/CLAUDE.md 2>/dev/null || true
fi

# Initial commit
echo "[7/8] Creating initial commit..."
git add -A
git commit -m "chore: initial project scaffold

TheDarkFactory standard structure with:
- SPEC template (12 questions)
- CLAUDE.md for AI assistant context
- CI pipeline (GitHub Actions)
- Memex MCP integration
- Standard README, .gitignore, .env.example

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push -u origin main

# Create GitHub labels
echo "[8/8] Creating GitHub labels..."
gh label create "enhancement" --color "a2eeef" --repo "$ORG/$PROJECT_NAME" 2>/dev/null || true
gh label create "bug" --color "d73a4a" --repo "$ORG/$PROJECT_NAME" 2>/dev/null || true
gh label create "security" --color "e4e669" --repo "$ORG/$PROJECT_NAME" 2>/dev/null || true
gh label create "documentation" --color "0075ca" --repo "$ORG/$PROJECT_NAME" 2>/dev/null || true
gh label create "testing" --color "bfd4f2" --repo "$ORG/$PROJECT_NAME" 2>/dev/null || true
gh label create "devops" --color "d4c5f9" --repo "$ORG/$PROJECT_NAME" 2>/dev/null || true
gh label create "ui" --color "f9d0c4" --repo "$ORG/$PROJECT_NAME" 2>/dev/null || true
gh label create "v1" --color "006b75" --repo "$ORG/$PROJECT_NAME" 2>/dev/null || true
gh label create "v2" --color "5319e7" --repo "$ORG/$PROJECT_NAME" 2>/dev/null || true

echo ""
echo "=== Done! ==="
echo ""
echo "Project created at: $PROJECT_DIR"
echo "GitHub: https://github.com/$ORG/$PROJECT_NAME"
echo ""
echo "Next steps:"
echo "  1. cd $PROJECT_DIR"
echo "  2. Fill in SPEC.md (answer the 12 questions)"
echo "  3. Update .claude/CLAUDE.md with project-specific context"
echo "  4. Start building!"
