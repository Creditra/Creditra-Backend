# Commit Conventions

This repository uses [Conventional Commits](https://www.conventionalcommits.org/)
for its commit messages. The format keeps history scannable and lets us
generate changelogs mechanically.

## Subject line

```
<type>(<optional scope>): <imperative summary>
```

- **type** — one of `feat`, `fix`, `docs`, `chore`, `refactor`, `test`,
  `perf`, `build`, `ci`, `style`.
- **scope** — optional area of the codebase, e.g. `utils`, `routes`,
  `migrations`.
- **summary** — present-tense, lowercase, no trailing period. Aim for
  under 72 characters.

### Good examples

- `feat(utils): add numeric helpers (clamp, parsePositiveInt)`
- `fix(auth): reject expired tokens with 401 instead of 403`
- `docs: document the standard API response envelope`

### Anti-patterns

- `Fixed stuff` — no type, vague summary.
- `feat: implement everything for milestone 3` — not atomic.
- `chore: WIP` — meaningless commit message.

## Body (optional)

If a commit needs context, add a body separated by a blank line. Explain
the **why**, not the **what** — the diff already shows what changed.

## Atomicity

One logical change per commit. If you find yourself writing "and" in the
subject line, split the commit.
