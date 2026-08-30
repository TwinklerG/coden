# npm-distributed CodeN Plugins

Use npm distribution for reusable or multi-file implementations, semantic versioning, team sharing, public distribution, managed runtime dependencies, or a package that exposes multiple tools.

## Supported source

CodeN v1 installs only these source forms from the 公开 npmjs registry at `https://registry.npmjs.org`:

```text
npm:<package>
npm:<package>@<version-or-tag>
```

Private registries, Git repositories, arbitrary URLs, and local-directory install sources are unsupported. Do not suggest a source form the current installer cannot parse.

## Package contract

Build source before packaging. The installed package must have:

- `"type": "module"`;
- a non-empty `name` and `version`;
- a built `.js` or `.mjs` entry included in the package;
- `coden.apiVersion` equal to `1`;
- `coden.plugin` beginning with `./`, ending in `.js` or `.mjs`, containing no whitespace, URL, backslash, or `..` path segment, and resolving inside the package;
- a `files` list or equivalent package configuration that includes every runtime file and dependency needed by the entry.

Adapt `../assets/npm-package.json` and `../assets/npm-tsconfig.json` rather than copying identifiers or versions blindly. Align `@twinklerg/coden` with the CodeN release the plugin targets; the version in the asset is an example synchronized with this repository revision, not a permanent recommendation.

## Default export

Choose one form:

1. Default-export one `ToolDefinition` for a single tool. Start from `../assets/npm-single-tool.ts`.
2. Default-export a non-empty `CodeNPlugin` for multiple tools. Start from `../assets/npm-multi-tool.ts`; its `name` must exactly equal the npm package name and its `apiVersion` must be the API v1 literal `1`.

Every tool must independently satisfy the name, schema, risk, result, and cancellation rules in `api-contract.md`. Tool names still cannot collide with built-ins, project plugins, or previously loaded npm plugins.

## Dependencies and execution boundary

Keep `@twinklerg/coden` in `devDependencies` and use `import type` for plugin interfaces. Because consumers do not install a package's `devDependencies`, do not leave a runtime import of `@twinklerg/coden/plugin` in emitted JavaScript; use the API version literal `1` in a `CodeNPlugin` value. Runtime libraries belong in `dependencies` and must be present in the packed artifact's install graph. Do not import the unexported package root or CodeN source files.

Avoid top-level side effects. Installation disables npm lifecycle scripts by default, but CodeN still imports the entry during validation. That import and all later tool calls run in-process with the current user's full permissions. The declared `risk` affects call confirmation and is not a sandbox.

## Test offline

Import the default export from source in unit tests. For each tool, cover valid input, invalid input or an expected operational failure, and cancellation when work can be long-running. Use a temporary workspace and `AbortController`; stub network and subprocess boundaries and never require real credentials.

For a multi-tool export, additionally assert:

- `apiVersion === CODEN_PLUGIN_API_VERSION`;
- plugin `name` equals `package.json` `name`;
- `tools` is non-empty;
- all tool names are unique.

## Validation sequence

Use the target project's actual scripts. A conventional sequence is:

```bash
bun run format
bun run typecheck
bun run test
bun run build
npm pack --dry-run
```

Before the pack check, inspect package lifecycle scripts because npm pack can run them. Do not run lifecycle scripts without explicit user confirmation; when unapproved, use the package manager's script-disabling option if supported. Then inspect the dry-run file list and verify:

- the configured `coden.plugin` entry is present;
- no source maps, credentials, tests, local configuration, or unrelated source are included accidentally;
- a clean install can resolve all runtime dependencies;
- the built entry uses ESM and imports successfully under the supported runtime.

Never run `npm publish` without explicit user confirmation.

## Install and operation

After validation, report these commands rather than executing mutating operations without confirmation:

```bash
coden plugin install npm:@scope/coden-plugin-example
coden plugin list
coden plugin sync
```

Add `--global` to install or sync in user scope; project scope is the default. `install`, `sync`, and `remove` mutate plugin state and require user approval. Lifecycle scripts remain disabled unless the user explicitly approves `--allow-scripts`; `--yes` only skips prompts and does not enable scripts.

Project npm plugins also require workspace trust. After installation, removal, upgrade, or sync, restart CodeN. `/reload` guarantees fresh loading only for local `.ts` plugins because npm entries and dependencies use normal file URLs and runtime module caching.

## Release boundary

Do not run any of the following without explicit user confirmation:

- `npm publish`;
- `coden plugin install`, `remove`, or `sync`;
- any command with `--allow-scripts`;
- any destructive cleanup or versioning operation.

Before a confirmed release, report the intended registry, package name, version, public files, provenance or authentication assumptions, and remaining security risks.
