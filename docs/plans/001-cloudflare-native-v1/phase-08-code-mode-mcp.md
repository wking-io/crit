# Phase 8: OAuth Code Mode MCP and provenance

## Outcome

Give remote Agents a small, secure, auditable interface to the same Canvas operations.

## Build

- Publish OAuth discovery, registration, authorization, token, and bearer-protected MCP routes.
- Redirect authorization through the Access-protected application callback for verified company identity and consent.
- Expose only `search` and `execute`.
- Run generated code through `CodeExecutionRuntime` with one allowlisted, schema-validated host callback.
- Keep tokens, bindings, arbitrary fetch, filesystem, D1, R2, and Durable Object namespaces outside the sandbox.
- Record Agent, delegating Person, OAuth client, grant, execution, accepted changes, and optional reported harness, model, session, and task metadata.
- Store no private reasoning trace.

## Prove

- PKCE, consent, scopes, expiry, revocation, and Workspace authorization work end to end.
- Sandbox escape attempts cannot access credentials, bindings, network, or another Workspace.
- Retried execution calls return prior accepted results.
- The UI clearly says which Agent acted and which Person authorized it.
- A fake runtime passes the same contract as the Cloudflare Code Mode adapter.
