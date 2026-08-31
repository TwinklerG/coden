set shell := ["bash", "-c"]
set dotenv-load

# Run CodeN
run *args:
  bun run src/cli/index.ts {{args}}

# Build a portable single-file Node CLI into dist/index.js (used as npm bin)
build:
  bun run build

# Run the offline test suite
test:
  bun run test

# Format source and tests
fmt:
  bun run format

# Lint, typecheck, and test
check:
  bun run biome check --config-path . src test
  bun run typecheck
  bun run test

# Start the product website locally
website-dev:
  cd website && bun run dev

# Lint, typecheck, test, build, and validate the product website
website-check:
  cd website && bun install --frozen-lockfile && bun run check

# Build the product website
website-build:
  cd website && bun install --frozen-lockfile && bun run build

# Verify exactly what npm would publish (no upload)
publish-dry-run:
  npm publish --dry-run

# Verify a git tag vX.Y.Z matches package.json version
check-tag-version tag:
  bun run src/release/check-tag-version-cli.ts {{tag}}

# Lint, typecheck, test, then publish to npm (scoped package → --access public)
publish:
  bun run lint
  bun run typecheck
  bun run test
  npm publish --access public
