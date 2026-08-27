set shell := ["bash", "-c"]
set dotenv-load

# Run CodeN
run *args:
  bun run src/cli/index.ts {{args}}

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
