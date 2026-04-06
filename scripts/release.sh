#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if version argument is provided
if [ -z "$1" ]; then
  echo -e "${RED}Error: Version number required${NC}"
  echo "Usage: npm run release <version>"
  echo "Example: npm run release 0.7.2"
  exit 1
fi

NEW_VERSION=$1
RELEASE_DATE=$(date +%Y-%m-%d)

# Validate version format (semantic versioning)
if ! [[ $NEW_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo -e "${RED}Error: Invalid version format. Use semantic versioning (e.g., 0.7.2)${NC}"
  exit 1
fi

echo -e "${GREEN}Starting release process for v${NEW_VERSION}${NC}"
echo ""

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "Current version: ${YELLOW}${CURRENT_VERSION}${NC}"
echo -e "New version: ${YELLOW}${NEW_VERSION}${NC}"
echo ""

# Confirm with user
read -p "Continue with release? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Release cancelled."
  exit 0
fi

echo ""
echo -e "${GREEN}Step 1/5: Updating package.json${NC}"
# Update package.json version
sed -i "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json
echo "✓ package.json updated"

echo ""
echo -e "${GREEN}Step 2/5: Updating README.md${NC}"
# Update README.md badge
sed -i "s/version-${CURRENT_VERSION}-blue/version-${NEW_VERSION}-blue/" README.md
# Update README.md version mention
sed -i "s/> \*\*v${CURRENT_VERSION}\*\*/> **v${NEW_VERSION}**/" README.md
echo "✓ README.md updated"

echo ""
echo -e "${GREEN}Step 3/5: Updating CHANGELOG.md${NC}"
# Update CHANGELOG.md - replace [Unreleased] with version and date
sed -i "s/## \[Unreleased\]/## [${NEW_VERSION}] - ${RELEASE_DATE}/" CHANGELOG.md
# Add new [Unreleased] section at the top
sed -i "/^# Changelog/a\\
\\
## [Unreleased]\\
\\
### Added\\
\\
### Changed\\
\\
### Fixed\\
\\
### Database" CHANGELOG.md
echo "✓ CHANGELOG.md updated"

echo ""
echo -e "${GREEN}Step 4/5: Updating package-lock.json${NC}"
# Update package-lock.json (npm will do this, but we can trigger it)
npm install --package-lock-only
echo "✓ package-lock.json updated"

echo ""
echo -e "${GREEN}Step 5/5: Creating git commit and tag${NC}"
git add package.json package-lock.json README.md CHANGELOG.md
git commit -m "chore: release v${NEW_VERSION}

Update version to ${NEW_VERSION} across all documentation.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"

echo "✓ Committed and tagged"

echo ""
echo -e "${GREEN}Release v${NEW_VERSION} prepared successfully!${NC}"
echo ""
echo "Next steps:"
echo "  1. Review the changes: git show HEAD"
echo "  2. Push to remote: git push origin dev && git push origin v${NEW_VERSION}"
echo "  3. Create PR to merge dev → main"
echo ""
