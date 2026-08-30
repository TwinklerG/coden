# Local TypeScript Tool Plugins

Use a local plugin for one private tool, project-specific behavior, or fast iteration with `/reload`.

## Discovery and explicit paths

CodeN scans these default locations:

```text
User path: ~/.config/coden/plugins/*.ts
Project path: <workspace>/.coden/plugins/*.ts
Additional path: coden --plugin ./path-or-directory
Reload: /reload
```

The user and project configuration files are `~/.config/coden/config.json` and `<workspace>/.coden/config.json`. Their `plugins` field is an array of file or directory paths. The CLI also accepts repeatable `--plugin` arguments. Prefer project-relative paths for project configuration when practical.

Project plugins require workspace trust unless CodeN is running in explicitly approved automatic mode. A local plugin runs in-process with the current user's full filesystem, network, environment, and subprocess permissions. Its `risk` value controls invocation confirmation, not isolation.

## Loader contract

A local plugin must:

- be a self-contained `.ts` file（自包含单文件）;
- default-export exactly one `ToolDefinition`;
- avoid relative runtime imports such as `./helper.ts` or `../shared.js`;
- avoid top-level side effects.

CodeN reads the source and imports it through a `data:text/typescript` URL so content changes can bypass Bun's real-path module cache. Relative runtime imports therefore have no file location from which to resolve. Type-only imports from `@twinklerg/coden/plugin` are safe because TypeScript removes them. Bare npm imports may work when the dependency is resolvable from the current working directory, but they make the local plugin depend on that environment; prefer an npm plugin when multiple source files or managed dependencies are needed.

Start from `../assets/local-tool.ts` and adapt the name, schema, narrowing, result, cancellation behavior, and risk. Do not copy the example without checking the actual contract.

## Configuration examples

Pass one or more explicit paths:

```bash
coden --plugin ./.coden/plugins/example.ts --plugin ./tools/private-plugins
```

Or add paths to either supported `config.json`:

```json
{
  "plugins": ["./.coden/plugins/example.ts", "./tools/private-plugins"]
}
```

The default project directory needs no extra configuration when the file is already under `<workspace>/.coden/plugins/*.ts`.

## Test directly

Import the default tool in an offline unit test and call `execute()` with:

- a temporary directory as `workspace`;
- an `AbortController().signal`;
- valid input for the success path;
- malformed input for the expected-error path;
- an already-aborted or later-aborted signal when work can be long-running.

Assert that the declared `risk` matches the observable behavior. Do not use real secrets or make real network calls by default.

## Validation checklist

1. Confirm the file default-exports one `ToolDefinition` and has no relative runtime imports.
2. Confirm the tool name is valid and does not collide with built-ins or other plugins.
3. Compile the JSON Schema and keep it aligned with runtime narrowing.
4. Confirm `risk` reflects all file, network, subprocess, or remote-state effects.
5. Run formatting, strict typechecking, and offline tests.
6. Check that module import itself performs no external operation or secret-bearing output.
7. Place the file in a default location, configure it, or pass `--plugin`.
8. Obtain project trust before the first project-plugin load.
9. Start CodeN and inspect plugin load failures without ignoring them.
10. After edits, run `/reload`; it reloads local `.ts` plugins and atomically replaces the candidate registry when loading succeeds.
