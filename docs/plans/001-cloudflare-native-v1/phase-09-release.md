# Phase 9: Installation, operations, and v1 release

## Outcome

Ship a repeatable customer-hosted installation and a coherent local-to-team workflow.

## Build

- Provide Wrangler configuration, D1 migrations, Durable Object migrations, R2 setup, Access instructions, hostname layout, and deployment verification.
- Add backup, export, restore, retention, key rotation, upgrade, and incident runbooks.
- Add platform OTLP adapters, operational metrics, exporter retention guidance, and incident correlation. Document the metadata each platform exports and how operators control sampling and retention.
- Add protocol negotiation and reject unsupported clients with actionable errors.
- Publish the SDK surfaces for domain operations, client access, React, Frame Bridge, and testing.
- Remove alpha code from the release artifact. Keep it only on a historical tag or branch if needed.

## Prove

- A fresh customer Cloudflare account installs from the documented procedure.
- A developer initializes locally, creates and reviews work offline, shares it, and continues offline.
- A teammate with no Crit install reviews the shared Canvas in the hosted UI, leaves a Note and comment, and the author's replica receives that work.
- Backup and restore reproduce D1 control data, Canvas ledgers, and R2 artifacts.
- Package, security, conformance, browser, and end-to-end release suites pass.
