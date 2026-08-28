# Task 3 Report — Specifiers, Scope Paths, Manifests, and Package Metadata

## Implementation summary
Implemented strict `npm:` specifier parsing, deterministic plugin scope/path resolution, manifest read/write helpers, and installed package metadata validation with realpath boundary checks.

## Files changed
- `src/plugins/specifier.ts`
- `src/plugins/paths.ts`
- `src/plugins/manifest.ts`
- `src/plugins/package-metadata.ts`
- `test/plugins/specifier-manifest.test.ts`
- `test/plugins/package-metadata-loader.test.ts`
- `test/fixtures/npm-plugins/invalid/missing-metadata/.gitkeep`
- `test/fixtures/npm-plugins/invalid/unsupported-api/.gitkeep`
- `test/fixtures/npm-plugins/invalid/escaped-entry/.gitkeep`

## TDD evidence
### RED
Command:
- `bun run test test/plugins/specifier-manifest.test.ts test/plugins/package-metadata-loader.test.ts`

Output (expected failures before implementation):
- missing module errors for `../../src/plugins/manifest.js` and `../../src/plugins/package-metadata.js`

### GREEN
Command:
- `bun run test test/plugins/specifier-manifest.test.ts test/plugins/package-metadata-loader.test.ts`

Output:
- 2 test files passed, 24 tests passed

## Typecheck
Command:
- `bun run typecheck`

Output:
- passed (`tsc --noEmit`)

## Self-review
- Scoped package names are preserved correctly when building `node_modules/@scope/name` paths.
- Manifest serialization sorts keys and appends a trailing newline.
- Installed metadata validation enforces `type: "module"`, `coden.apiVersion === 1`, `.js`/`.mjs` entry points, and package-boundary realpath checks.

## Concerns
- None.

## Review findings
- no blockers

## Residual risks
- None known for this task.

## Acceptance report
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Implemented strict npm-only parsing, deterministic scope/manifest APIs, and realpath-safe installed package metadata in the requested src/plugins modules without widening scope."
    }
  ],
  "changedFiles": [
    "src/plugins/specifier.ts",
    "src/plugins/paths.ts",
    "src/plugins/manifest.ts",
    "src/plugins/package-metadata.ts",
    "test/plugins/specifier-manifest.test.ts",
    "test/plugins/package-metadata-loader.test.ts",
    "test/fixtures/npm-plugins/invalid/missing-metadata/.gitkeep",
    "test/fixtures/npm-plugins/invalid/unsupported-api/.gitkeep",
    "test/fixtures/npm-plugins/invalid/escaped-entry/.gitkeep"
  ],
  "testsAddedOrUpdated": [
    "test/plugins/specifier-manifest.test.ts",
    "test/plugins/package-metadata-loader.test.ts"
  ],
  "commandsRun": [
    {
      "command": "bun run test test/plugins/specifier-manifest.test.ts test/plugins/package-metadata-loader.test.ts",
      "result": "failed",
      "summary": "RED: missing-module failures before implementation were expected."
    },
    {
      "command": "bun run test test/plugins/specifier-manifest.test.ts test/plugins/package-metadata-loader.test.ts",
      "result": "passed",
      "summary": "GREEN: 24 tests passed across 2 files."
    },
    {
      "command": "bun run typecheck",
      "result": "passed",
      "summary": "TypeScript check passed."
    }
  ],
  "validationOutput": [
    "RED: missing module errors for src/plugins/manifest.js and src/plugins/package-metadata.js.",
    "GREEN: 2 test files passed, 24 tests passed.",
    "GREEN: tsc --noEmit passed."
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "Added npm plugin specifier parsing, plugin path and manifest utilities, and installed package metadata validation with tests and invalid fixture placeholders.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "Report written to satisfy missing artifact request; code was not changed in this follow-up."
}
```

## Fix round 1

### Changes made
- Tightened `parseNpmPluginSpecifier()` to reject non-registry requests in the requested portion (`:` or `/`) while preserving semver/range/tag strings.
- Scoped parsing now uses the final `@` after `/`, and scoped packages without a version still resolve to `latest`.
- Changed `PluginPaths.lockPath` to a dedicated scope lock directory (`.../plugin-lock`) instead of the runtime `bun.lock` file path.
- Expanded focused tests to cover invalid registry-like requests and the new lock-directory path shape.

### Commands run
- `bun run test test/plugins/specifier-manifest.test.ts test/plugins/package-metadata-loader.test.ts`
  - passed: 2 files, 27 tests passed
- `bun run typecheck`
  - passed (`tsc --noEmit`)

### Self-review
- No scope widened beyond the two reviewed defects.
- The new lock directory remains separate from the runtime `bun.lock` file location for later tasks to derive.

### Concerns
- None.
