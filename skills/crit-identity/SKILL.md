---
name: crit-identity
description: Verifies and repairs the repository-local Git Author identity required by Crit. Use when Crit reports missing or invalid identity, when initializing Crit for a user, or before creating owned Canvases.
---

# Crit Identity

1. Run `npx @riff-refine/crit identity --json` from the project root. Identity is verified when the command returns an Author with non-empty `id` and `name`.
2. If verification fails, inspect the effective values with `git config --get user.name` and `git config --get user.email`.
3. Ask the user for every missing or invalid value. Treat their answer as the only authority; do not infer identity from repository history, remotes, hosting accounts, or other users.
4. Set confirmed values for this repository with `git config --local user.name <name>` and `git config --local user.email <email>`.
5. Run `npx @riff-refine/crit identity --json` again. Finish only when it returns the confirmed Author.

Preserve valid values. Keep all writes repository-local; global Git configuration is outside this skill's scope.
