# `/skills` Skill Name Emphasis Design

## Goal

Improve `/skills` readability by visually separating each Skill name from its scope and description.

## Behavior

Each nonempty `/skills` line keeps its existing content and order:

```text
<name> (<scope>): <description>
```

Only `<name>` is rendered in bold. Scope, punctuation, description, sorting, and the empty-registry message remain unchanged. The system-prompt Skill catalog is unaffected.

## Implementation

`src/skills/prompt.ts` continues to own `/skills` formatting and uses the project's existing `picocolors` dependency. `formatSkillsList()` accepts an optional colors implementation that defaults to `picocolors`; production therefore follows Picocolors' existing TTY, `NO_COLOR`, and redirected-output behavior, while tests can inject `picocolors.createColors(true)` for deterministic ANSI assertions.

No second terminal styling dependency is introduced, and no unrelated Picocolors migration is included.

## Testing

Update `test/skills.test.ts` to verify:

- forced-color output wraps only the Skill name in bold ANSI sequences;
- scope and description remain unchanged;
- the existing plain-text and empty-registry behavior remains valid when colors are disabled.
