# P1-02 IDs and identity

GOAL

Implement the target domain's validated semantic IDs and Person, Agent, Principal, and accepted-attribution shapes without adding Canvas behavior.

SCOPE

Write only `packages/domain/src`, its tests and fixtures, and the minimum package-local test configuration. The P1-01 scaffold and alpha tree are read-only.

ACCEPTANCE

- Every semantic ID is branded and can only be produced by a validating parser or constructor.
- Actor is a Person or Agent snapshot.
- Principal models authenticated Person and delegated Agent requests.
- Accepted attribution models Person work or Agent work with delegating Person, OAuth client, grant, execution, and optional reported runtime metadata.
- Authentication subjects remain outside Canvas content and accepted attribution.
- Reported runtime metadata is visibly distinguished from server-verified fields.
- External data is decoded at the package boundary.
- Public exports are deliberate and contain no alpha Author, owner, Git, storage, HTTP, React, or Cloudflare type.

VERIFY

Run focused tests for every valid and invalid ID, exhaustive identity variants, encoded round trips, malformed external data, and absence of forbidden fields. Run target boundaries, target build, and existing typecheck.

FORBIDDEN

No Canvas commands, projection, protocol envelopes, compatibility codecs, platform imports, Git identity, mutable handles, staging, or commits.

REPORT

Return caller usage, exact public exports, paths changed, commands run, results, deviations, and risks.
