#!/bin/bash

# Git Commit with Auto Version Bump for Whats91 Chat
# Usage:
#   ./scripts/git-commit.sh "your commit message"        # Patch bump (default)
#   ./scripts/git-commit.sh "feat: your message"         # Minor bump (new feature)
#   ./scripts/git-commit.sh "fix: your message"          # Patch bump
#   ./scripts/git-commit.sh "breaking: your message"     # Major bump
#   ./scripts/git-commit.sh --major "your message"       # Major bump (explicit)
#   ./scripts/git-commit.sh --minor "your message"       # Minor bump (explicit)
#   ./scripts/git-commit.sh --patch "your message"       # Patch bump (explicit)

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
  echo "  ./scripts/git-commit.sh \"your commit message\"        # Patch bump (default)"
  echo "  ./scripts/git-commit.sh \"feat: your message\"         # Minor bump (new feature)"
  echo "  ./scripts/git-commit.sh \"fix: your message\"          # Patch bump"
  echo "  ./scripts/git-commit.sh \"breaking: your message\"     # Major bump"
  echo "  ./scripts/git-commit.sh --major \"your message\"       # Major bump (explicit)"
  echo "  ./scripts/git-commit.sh --minor \"your message\"       # Minor bump (explicit)"
  echo "  ./scripts/git-commit.sh --patch \"your message\"       # Patch bump (explicit)"
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
echo "📦 Version bump: $CURRENT_VERSION → $NEW_VERSION ($BUMP_TYPE)"
echo ""

# Stage all changes including version.txt
git add -A

# Commit with message
git commit -m "$COMMIT_MSG"

echo ""
echo "✅ Commit created with version $NEW_VERSION"
echo ""

# Show git log
git log -1 --oneline
