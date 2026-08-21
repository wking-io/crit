# P1-01 package boundaries

GOAL

Create the target workspace and TypeScript dependency scaffold so domain and protocol code can be implemented without importing the alpha tree.

SCOPE

Write root workspace/build configuration and empty target package entry points only. Do not edit existing alpha source, tests, playground, documentation, or user-modified files.

ACCEPTANCE

- The target package graph exists for domain, protocol, authority, replica, representations, client, react, frame-bridge, local, cloudflare, and cli.
- Domain and protocol compile without platform imports.
- One rerunnable dependency-boundary check fails on forbidden imports.
- Existing alpha checks still resolve.

VERIFY

Run the new boundary check, TypeScript typecheck, and the narrow package build check introduced by this unit.

FORBIDDEN

No Git state changes. No compatibility wrappers. No implementations beyond the minimum compileable package surfaces.

REPORT

Return paths changed, exact commands run, results, deviations, and risks.
