#!/usr/bin/env bash

###############################################################################
# Engram Git Hook Capture (#36)
#
# Auto-captures sessions on git commit for zero-effort knowledge recording
#
# Installation:
#   ln -s ../../Engram/scripts/git-hook-capture.sh .git/hooks/post-commit
#
# Or use the install command:
#   Engram/scripts/git-hook-capture.sh install
#
# Features:
# - Extracts session info from commit message
# - Auto-detects topics from changed files and commit message
# - Captures code changes statistics
# - Zero manual effort - just commit normally
#
# Commit Message Format (optional enhancement):
#   Add [engram: topic1, topic2] to your commit message to tag topics
#   Example: "feat(auth): add OAuth2 [engram: auth, security]"
###############################################################################

set -e

# Get script directory (works even when called as symlink)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Try to get ENGRAM_PATH from: 1) env var, 2) git config, 3) relative to script
GIT_CONFIG_PATH=$(git config --get engram.path 2>/dev/null || echo "")
DEFAULT_PATH="$(dirname "$SCRIPT_DIR")/.."
ENGRAM_PATH="${ENGRAM_PATH:-${GIT_CONFIG_PATH:-$DEFAULT_PATH}}"
REMEMBER_SCRIPT="$ENGRAM_PATH/scripts/remember"

# Configuration
MIN_COMMIT_MESSAGE_LENGTH=10
SKIP_MERGE_COMMITS=true
SKIP_WIP_COMMITS=true

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

###############################################################################
# Helper Functions
###############################################################################

log() {
  echo -e "${BLUE}[Engram]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[Engram]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[Engram]${NC} $1"
}

log_error() {
  echo -e "${RED}[Engram]${NC} $1"
}

###############################################################################
# Install/Uninstall
###############################################################################

install_hook() {
  local repo_root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$repo_root" ]; then
    log_error "Not in a git repository"
    exit 1
  fi

  local hook_path="$repo_root/.git/hooks/post-commit"
  local this_script="$ENGRAM_PATH/scripts/git-hook-capture.sh"

  if [ -f "$hook_path" ]; then
    log_warn "post-commit hook already exists"
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      log "Installation cancelled"
      exit 0
    fi
    rm "$hook_path"
  fi

  ln -s "$this_script" "$hook_path"
  chmod +x "$hook_path"
  log_success "Installed post-commit hook at $hook_path"
}

uninstall_hook() {
  local repo_root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$repo_root" ]; then
    log_error "Not in a git repository"
    exit 1
  fi

  local hook_path="$repo_root/.git/hooks/post-commit"

  if [ ! -f "$hook_path" ]; then
    log_warn "No post-commit hook found"
    exit 0
  fi

  rm "$hook_path"
  log_success "Uninstalled post-commit hook"
}

###############################################################################
# Session Capture Logic
###############################################################################

capture_session() {
  # Get last commit info
  local commit_hash=$(git rev-parse HEAD)
  local commit_message=$(git log -1 --pretty=%B)
  local commit_short=$(git log -1 --pretty=%s)
  local commit_date=$(git log -1 --format=%cd --date=short)

  # Skip conditions
  if [ "$SKIP_MERGE_COMMITS" = true ] && echo "$commit_message" | grep -q "^Merge"; then
    log "Skipping merge commit"
    exit 0
  fi

  if [ "$SKIP_WIP_COMMITS" = true ] && echo "$commit_short" | grep -iq "^wip\|^WIP"; then
    log "Skipping WIP commit"
    exit 0
  fi

  if [ ${#commit_short} -lt $MIN_COMMIT_MESSAGE_LENGTH ]; then
    log "Skipping short commit message"
    exit 0
  fi

  # Extract topics from commit message
  local topics=""
  if echo "$commit_message" | grep -q "\[engram:"; then
    topics=$(printf '%s\n' "$commit_message" | sed -n 's/.*\[engram:[[:space:]]*\([^]]*\)\].*/\1/p' | tr ',' '\n' | tr -s ' \t\n' ' ' | sed 's/^ //;s/ $//')
  fi

  # Auto-detect topics from commit type
  local commit_type=$(echo "$commit_short" | sed -n 's/^\([a-z]*\)(.*/\1/p')
  if [ -n "$commit_type" ]; then
    topics="$topics $commit_type"
  fi

  # Auto-detect topics from changed files
  local changed_files=$(git diff-tree --no-commit-id --name-only -r HEAD)

  if echo "$changed_files" | grep -q "Dockerfile\|docker-compose"; then
    topics="$topics docker"
  fi

  if echo "$changed_files" | grep -q "\.github/workflows\|\.gitlab-ci\.yml"; then
    topics="$topics cicd"
  fi

  if echo "$changed_files" | grep -q "package\.json\|yarn\.lock\|package-lock\.json"; then
    topics="$topics dependencies"
  fi

  if echo "$changed_files" | grep -q "\.test\.\|\.spec\.\|test/\|tests/"; then
    topics="$topics test"
  fi

  if echo "$changed_files" | grep -q "README\|\.md$"; then
    topics="$topics docs"
  fi

  # Get code change statistics
  local stats=$(git diff HEAD~1 HEAD --numstat | awk '{ added += $1; removed += $2 } END { print added","removed }')
  local lines_added=$(echo "$stats" | cut -d',' -f1)
  local lines_removed=$(echo "$stats" | cut -d',' -f2)

  # Get project name (from git remote or directory)
  local project=$(git config --get remote.origin.url | sed -n 's#.*/\([^/]*\)\.git$#\1#p')
  if [ -z "$project" ]; then
    project=$(basename $(git rev-parse --show-toplevel))
  fi

  # Build session summary
  local summary="$commit_short"

  # Prepare topics (unique, trimmed)
  topics=$(echo "$topics" | tr ' ' '\n' | sort -u | tr '\n' ',' | sed 's/,$//')

  log "Capturing session from commit: $commit_hash"
  log "  Project: $project"
  log "  Summary: $summary"
  log "  Topics: $topics"
  log "  Changes: +$lines_added/-$lines_removed lines"

  # Check if remember script exists
  if [ ! -f "$REMEMBER_SCRIPT" ]; then
    log_error "Remember script not found at $REMEMBER_SCRIPT"
    log "Session capture failed - please run manually: remember"
    exit 0  # Don't fail the commit
  fi

  # Call remember script with auto-captured data
  # Run in background to not delay commit
  (
    export ENGRAM_AUTO_CAPTURE=1
    export ENGRAM_PROJECT="$project"
    export ENGRAM_SUMMARY="$summary"
    export ENGRAM_TOPICS="$topics"
    export ENGRAM_COMMIT="$commit_hash"
    export ENGRAM_LINES_ADDED="$lines_added"
    export ENGRAM_LINES_REMOVED="$lines_removed"

    "$REMEMBER_SCRIPT" --auto 2>&1 | while read line; do
      log "$line"
    done
  ) &

  log_success "Session capture initiated (running in background)"
}

###############################################################################
# Main
###############################################################################

case "${1:-capture}" in
  install)
    install_hook
    ;;
  uninstall)
    uninstall_hook
    ;;
  capture)
    capture_session
    ;;
  *)
    echo "Usage: git-hook-capture.sh {install|uninstall|capture}"
    echo ""
    echo "Commands:"
    echo "  install    - Install post-commit hook in current repo"
    echo "  uninstall  - Remove post-commit hook"
    echo "  capture    - Capture session (called automatically by hook)"
    exit 1
    ;;
esac
