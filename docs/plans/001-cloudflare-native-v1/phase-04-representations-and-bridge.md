# Phase 4: Representations and Frame Bridge

## Outcome

Render the same logical Frame locally and in a review deployment without rewriting Canvas state.

## Build

- Implement `applicationRoute`, `webUrl`, and digest-bound `artifact` references.
- Implement local and shared `RepresentationRuntime` adapters returning `RenderPlan`.
- Separate checked-in Application identity from machine bindings and shared Deployment bindings.
- Publish a framework-neutral, versioned Frame Bridge. The host assigns iframe src. The page reports route. Unselected Frames use a capture overlay. Origins are explicit.
- Encode the closed activation matrix in build adapters and the installation skill.

## Prove

- One Application Route resolves to localhost locally and to a registered preview remotely.
- Missing bindings render a useful unavailable state.
- Artifact digest mismatch fails closed.
- Ordinary production build and preview contain no bridge marker.
- Explicit shared review preview contains the route script and rejects hostile origins or protocol versions.
