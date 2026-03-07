#!/bin/bash

# Git Push with Auto Version Bump for Whats91 Chat
# This script combines version bump, commit, and push into one command
#
# Usage:
#   ./scripts/git-push.sh "your commit message"        # Patch bump (default)
#   ./scripts/git-push.sh "feat: your message"         # Minor bump (new feature)
#   ./scripts/git-push.sh "fix: your message"          # Patch bump
#   ./scripts/git-push.sh "breaking: your message"     # Major bump
#   ./scripts/git-push.sh --major "your message"       # Major bump (explicit)
#   ./scripts/git-push.sh --minor "your message"       # Minor bump (explicit)
#   ./scripts/git-push.sh --patch "your message"       # Patch bump (explicit)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="$(dirname "$SCRIPT_DIR")/version.txt"

# Parse arguments
BUMP_TYPE="auto"
COMMIT_MSG=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --major)
      BUMP_TYPE="major"
      shift
      ;;
    --minor)
      BUMP_TYPE="minor"
      shift
      ;;
    --patch)
      BUMP_TYPE="patch"
      shift
      ;;
    *)
      COMMIT_MSG="$1"
      shift
      ;;
  esac
done

if [ -z "$COMMIT_MSG" ]; then
  echo "❌ Error: Commit message is required"
  echo ""
  echo "Usage:"
  echo "  ./scripts/git-push.sh \"your commit message\"        # Patch bump (default)"
  echo "  ./scripts/git-push.sh \"feat: your message\"         # Minor bump (new feature)"
  echo "  ./scripts/git-push.sh \"fix: your message\"          # Patch bump"
  echo "  ./scripts/git-push.sh \"breaking: your message\"     # Major bump"
  echo "  ./scripts/git-push.sh --major \"your message\"       # Major bump (explicit)"
  echo "  ./scripts/git-push.sh --minor \"your message\"       # Minor bump (explicit)"
  echo "  ./scripts/git-push.sh --patch \"your message\"       # Patch bump (explicit)"
  exit 1
fi

# Determine bump type from commit message if auto
if [ "$BUMP_TYPE" = "auto" ]; then
  if [[ "$COMMIT_MSG" =~ ^(breaking|BREAKING|major|MAJOR)[:\!] ]] || [[ "$COMMIT_MSG" =~ \!$: ]]; then
    BUMP_TYPE="major"
  elif [[ "$COMMIT_MSG" =~ ^(feat|feature|minor)[:\!] ]]; then
    BUMP_TYPE="minor"
  else
    BUMP_TYPE="patch"
  fi
fi

# Get current version
if [ -f "$VERSION_FILE" ]; then
  CURRENT_VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
else
  CURRENT_VERSION="1.0.0"
fi

# Parse version
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Bump version
case $BUMP_TYPE in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"

# Write new version
echo "$NEW_VERSION" > "$VERSION_FILE"

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  🚀 Whats91 Chat - Git Push with Version Bump"
echo "══════════════════════════════════════════════════════════"
echo ""
echo "📦 Version bump: $CURRENT_VERSION → $NEW_VERSION ($BUMP_TYPE)"
echo ""

# Stage all changes including version.txt
git add -A

# Show what will be committed
echo "📋 Files to be committed:"
git status --short
echo ""

# Commit with message
echo "💾 Creating commit..."
git commit -m "$COMMIT_MSG"

echo ""
echo "📤 Pushing to origin/main..."
git push origin main

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  ✅ Successfully pushed version $NEW_VERSION"
echo "══════════════════════════════════════════════════════════"
echo ""

# Show git log
git log -1 --oneline
