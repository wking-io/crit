# Phase 4: Representations and Frame Bridge

## Outcome

Render the same logical Frame locally and in a review deployment without rewriting Canvas state.

## Build

- Implement `applicationRoute`, `webUrl`, and digest-bound `artifact` references.
- Implement local and shared `RepresentationRuntime` adapters returning `RenderPlan`.
- Separate checked-in Application identity from machine bindings and shared Deployment bindings.
- Publish a framework-neutral, versioned Frame Bridge. The host assigns iframe src. The page reports route. Unselected Frames use a capture overlay. Origins are explicit.
- Encode the closed activation matrix in build adapters and the installation skill.
- Encode preview frameability in that skill. Shared-review-preview responses send `frame-ancestors` for the Crit host. Ordinary production does not name the Crit host. If the preview is Access-gated, the skill turns on `allow_iframe` and SameSite None.

## Prove

- One Application Route resolves to localhost locally and to a registered preview remotely.
- Missing bindings render a useful unavailable state.
- Artifact digest mismatch fails closed.
- Ordinary production build and preview contain no bridge marker and do not name the Crit host in `frame-ancestors`.
- Explicit shared review preview contains the route script, sends `frame-ancestors` for the Crit host, and rejects hostile origins or protocol versions.
- An Access-gated review preview has an Access login page that can load in an iframe.
