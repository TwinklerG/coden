set shell := ["bash", "-c"]
set dotenv-load

# Run CodeN
run *args:
  bun run src/cli/index.ts {{args}}

# Build a standalone binary (bun build --compile) into dist/
build:
  mkdir -p dist
  bun build src/cli/index.ts --compile --outfile dist/coden

# Run the offline test suite
test:
  bun run test

# Format source and tests
fmt:
  bun run format

# Lint, typecheck, and test
check:
  bun run lint
  bun run typecheck
  bun run test

# Verify exactly what npm would publish (no upload)
publish-dry-run:
  npm publish --dry-run

# Lint, typecheck, test, then publish to npm (scoped package → --access public)
publish:
  bun run lint
  bun run typecheck
  bun run test
  npm publish --access public
