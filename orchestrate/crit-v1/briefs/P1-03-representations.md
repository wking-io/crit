# P1-03 Representations

GOAL

Implement the target domain's logical Representation vocabulary and serializable page state without adding resolution or Canvas behavior.

SCOPE

Write only `packages/domain/src`, `packages/domain/test`, and generated domain output. Existing ID and identity behavior is read-only.

ACCEPTANCE

- `RepresentationRef` is a closed union of `application-route`, `web-url`, and `artifact`.
- Application Routes require Application ID, a normalized rooted route, and optional JSON page state.
- Web URLs use validated HTTP(S) URLs.
- Artifacts require Artifact ID and SHA-256 digest.
- Exact external decoding rejects extra, platform, credential, binding, deployment, and iframe-policy fields.
- Logical references contain no localhost, shared Deployment, render plan, credential, or bridge state.
- JSON round trips preserve every variant and nested state.

VERIFY

Run focused variant, route, state, digest, strict-decoding, exhaustive-match, and compile-time tests. Run domain tests, target boundaries/build, existing typecheck, focused lint, isolated package smoke, and diff check.

FORBIDDEN

No `RepresentationRuntime`, resolver, Canvas Frame, commands, transport, URL proxy, environment binding, compatibility field, staging, or commits.

REPORT

Return caller usage, public exports, exact paths and commands, deviations, and risks.
