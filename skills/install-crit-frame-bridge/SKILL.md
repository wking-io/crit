---
name: install-crit-frame-bridge
description: Installs or configures the Crit Frame Bridge in a web application with development-only activation and production verification. Use when adding Crit live-page comments, frame input relay, DOM-aware review, or Crit bridge instrumentation to a host project.
---

# Install Crit Frame Bridge

Install the narrowest adapter supported by the host. Preserve its package manager,
framework conventions, build modes, and existing configuration.

## Invariant

Use the closed activation matrix: local development is on, ordinary production
builds and previews are off, and an explicit shared review preview may opt in.
A missing or malformed review-preview flag must remain disabled.

Configure every bridge switch explicitly. Do not rely on package defaults.

## Workflow

1. Inspect the package manager, framework, build commands, environment handling,
   Content Security Policy, and existing Crit configuration. Finish only when
   the actual production and preview commands are known.
2. Install `@riff-refine/crit` with the project's package manager when it is not
   already present. Reuse the installed version when compatible.
3. Use the official adapter for the detected stack. For Vite, configure the
   plugin from the config callback so `command` and `mode` participate in the
   decision:

   ```ts
   export default defineConfig(({ command, mode }) => {
     const critEnabled = command === "serve" && mode === "development"

     return {
       plugins: [
         crit({
           enabled: critEnabled,
           frameInputBridge: critEnabled,
           frameCommentBridge: critEnabled
         })
       ]
     }
   })
   ```

   Adapt the condition to established mode names, but keep ordinary production,
   staging, CI builds, and production preview disabled.
4. For a stack without an official adapter, add a development-gated browser
   entry using that stack's server-only environment mechanism. Keep the gate at
   the composition root; application components must not decide whether the
   bridge is active. Do not invent a framework adapter inside the host project.
5. Preserve restrictive CSP and iframe policy. Add only the exact development
   origins required by Crit. Do not add wildcard origins, production proxying,
   embedded credentials, or automatic localhost tunneling.
6. Verify both branches:
   - Start the development command, open an instrumented page inside Crit, and
     prove the input and comment bridge handshake works.
   - Run the real production build and production preview. Inspect emitted HTML
     and assets for `data-crit-frame-input-bridge`,
     `data-crit-frame-comment-bridge`, and `@riff-refine/crit/frame-`. Finish
     only when all are absent and the application still works.
7. Run the project's focused checks and report the files changed, development
   activation condition, production proof, and any reduced capability caused
   by CSP or an unsupported adapter.

## Shared review preview opt-in

Enable the bridge outside local development only for a known review Deployment.
Use one positively named, server-controlled flag scoped to that Deployment,
require its exact affirmative value, register its allowed parent origin, and
tie every bridge option to the same result. Verify the review preview contains
the bridge while an ordinary build and preview from the same source do not.
