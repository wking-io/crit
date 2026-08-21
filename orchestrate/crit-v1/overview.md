# Crit v1 program

Done means all nine phases in `docs/plans/001-cloudflare-native-v1/overview.md` pass their focused proofs and the final local-to-Cloudflare release workflow passes end to end.

Estimated scope is 32 units across four tracks:

- Foundation. Domain, protocol, authority, replica, and conformance levers.
- Local product. Daemon, CLI, Representations, Frame Bridge, and review UI.
- Shared platform. Worker, Durable Objects, D1, R2, Access, and synchronization.
- Agents and release. OAuth Code Mode MCP, provenance, installation, operations, and release proof.

Phase 1 is the pilot. Its five units must validate the package boundary, type vocabulary, and verification recipe before Phase 2 starts.

The program store is local working state. It does not authorize commits, pushes, deployments, or destructive cleanup.
