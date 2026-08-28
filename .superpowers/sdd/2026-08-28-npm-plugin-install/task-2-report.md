# Task 2 report

Implemented the shared bounded process runner and Bun package-manager adapter.

## What changed
- Added `src/process/runner.ts` with `runProcess`, `ProcessRunResult`, `ProcessRunner`, and the moved `BoundedCollector` implementation.
- Added `src/plugins/package-manager.ts` and `src/plugins/bun-package-manager.ts`.
- Refactored `src/tools/builtin/bash.ts` to use `runProcess` while preserving timeout, cancellation, output truncation, metadata, and spawn-error handling.
- Added focused coverage in `test/plugins/process-package-manager.test.ts` and a small direct-runner smoke test in `test/tools.test.ts`.

## TDD evidence
### RED
- `bun run test test/plugins/process-package-manager.test.ts`
- Expected failure before implementation.
- Actual failure: `Cannot find module '../../src/plugins/bun-package-manager.js' imported from .../test/plugins/process-package-manager.test.ts`

### GREEN
- `bun run test test/plugins/process-package-manager.test.ts test/tools.test.ts` → passed
- `bun run typecheck` → passed
- `bun run format` → passed
- `git diff --check` → passed

## Files changed
- `src/process/runner.ts`
- `src/plugins/package-manager.ts`
- `src/plugins/bun-package-manager.ts`
- `src/tools/builtin/bash.ts`
- `test/plugins/process-package-manager.test.ts`
- `test/tools.test.ts`

## Residual risks
- None known for this task.

## No staged files
- Verified clean after commit (`git status --short` produced no output).

## Commit
- `7a566b7 refactor: share bounded process runner`

## Fix report — Task 2 review follow-up

### Change made
- Updated `src/process/runner.ts` so grouped timeout/cancel paths issue a final `SIGKILL` to the whole process group inside `finish()` before timers are cleared and the promise resolves. This preserves the prior Bash behavior for TERM-resistant descendants that outlive the leader.
- Added a focused regression test in `test/plugins/process-package-manager.test.ts` that keeps the leader alive until timeout, traps TERM to exit the leader, and verifies a descendant that ignores TERM does not survive to write a marker file.

### Commands run
- `bun run test test/plugins/process-package-manager.test.ts test/tools.test.ts`
- `bun run typecheck`

### Output summary
- `17/17 tests passed`
- `tsc --noEmit` passed

### Fix report acceptance
- The reviewer finding is addressed.
- No frozen-lockfile / allowScripts scope change was made.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Fixed the runner regression by restoring final group SIGKILL on grouped timeout/cancel without broadening Task 2 scope."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Recorded the fix commands, outputs, updated files, residual risk, and clean working-tree requirement for independent review."
    }
  ],
  "changedFiles": [
    "src/process/runner.ts",
    "test/plugins/process-package-manager.test.ts"
  ],
  "testsAddedOrUpdated": [
    "test/plugins/process-package-manager.test.ts"
  ],
  "commandsRun": [
    {
      "command": "bun run test test/plugins/process-package-manager.test.ts test/tools.test.ts",
      "result": "passed",
      "summary": "17/17 tests passed after the regression fix"
    },
    {
      "command": "bun run typecheck",
      "result": "passed",
      "summary": "TypeScript typecheck passed"
    }
  ],
  "validationOutput": [
    "17/17 tests passed",
    "tsc --noEmit passed"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "Grouped timeout/cancel now performs a final process-group SIGKILL before resolution, and a regression test guards TERM-resistant descendants.",
  "reviewFindings": [
    "addressed: src/process/runner.ts group SIGKILL on timeout/cancel"
  ],
  "manualNotes": ""
}
```
