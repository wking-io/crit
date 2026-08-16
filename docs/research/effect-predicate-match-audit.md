# Effect v4 `Predicate` and `Match` cleanup audit

Reviewed 2026-08-16 against Crit's installed `effect@4.0.0-rc.109` and the Effect project's first-party source. The audit covered all 170 TypeScript/JavaScript files under `src/`, `test/`, `playground/`, `scripts/`, and `tools/`; generated output and dependencies were excluded. No application or test code was changed.

## Result

`Match` has **seven clear cleanup opportunities** and three lower-priority candidates. The best uses are exhaustive dispatch over Crit's existing discriminated unions, especially where today's final `else` or fall-through branch implicitly means “the remaining variant.” These changes would make future union additions fail at compile time at the dispatch site.

`Predicate` has **three direct wins** and one broader deduplication opportunity. It should not replace ordinary domain booleans, Schema decoding, or concise `instanceof` checks one-for-one; most such substitutions would add vocabulary without adding safety.

Recommended implementation order:

1. `runtime/canvas-failure.ts`, `react/canvas-arrangement.ts`, and the Frame input handler in `react/canvas-viewport.tsx`.
2. `react/canvas-controls.ts`, `react/canvas-camera.ts`, `http/contract.ts`, and `session/comment-thread-review.ts`.
3. The two `Predicate.isNotUndefined` filters and the Canvas control interpolation lookup.
4. Consider a shared unknown-cause message helper only as a separate, repository-wide deduplication change.
5. Refactor the large Canvas command executor only after splitting it into smaller domain handlers.

## Exact v4 APIs relevant here

The installed v4 `Match` module supports both one-shot matching with `Match.value` and reusable functions with `Match.type`. Cases are ordered and can be completed with `exhaustive`, `orElse`, `option`, or `result`. For Crit's unions, the most relevant helpers are:

- `Match.tag(...tags, handler)` for one or more `_tag` variants sharing a handler.
- `Match.tagsExhaustive({...})` and `Match.valueTags(value, {...})` for exhaustive `_tag` dispatch.
- `Match.discriminatorsExhaustive("type")({...})` for Crit's unions whose discriminator is `type` instead of `_tag`.
- `Match.instanceOf(Class)` for class refinement inside a matcher.
- `Match.is(a, b, ...)` as a finite-literal pattern passed to `Match.when`.

These signatures and their exhaustiveness behavior are defined in the pinned [Effect `Match.ts` source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.109/packages/effect/src/Match.ts). The same source explicitly describes `Match.type` as reusable and `Match.value` as immediate matching, and documents that the `*Exhaustive` helpers require every discriminator value.

The installed v4 `Predicate` module distinguishes a boolean `Predicate<A>` from a narrowing `Refinement<A, B>`. The useful APIs for this repository are `isNotUndefined`, `isError`, `hasProperty`, `isTagged`, and the boolean combinators. `Predicate.Struct` checks selected fields but is not a replacement for Schema at untrusted I/O boundaries: its input type is already a record-like shape, extra fields are ignored, and it does not provide decode errors. See the pinned [Effect `Predicate.ts` source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.109/packages/effect/src/Predicate.ts).

## High-confidence `Match` changes

### 1. Replace manual Crit client error switches

**Location:** [`src/runtime/canvas-failure.ts`](../../src/runtime/canvas-failure.ts), lines 49–76
**Value:** high
**Confidence:** high

Both `critClientErrorMessage` and `isCurrentAuthorError` switch on a closed `_tag` union and carry a local `unreachableCritClientError` helper solely for exhaustiveness. This is the canonical `Match` use case.

Suggested shape:

```ts
export const critClientErrorMessage = (failure: CritClientError): string =>
  Match.value(failure).pipe(
    Match.tag("CritClientNotFound", ({ id }) => `Canvas not found: ${id}`),
    Match.tag(
      "CritClientCommandFailed",
      "CritClientInvalidDocument",
      "CritClientUnavailable",
      ({ detail }) => detail
    ),
    Match.exhaustive
  )
```

Do the same for `isCurrentAuthorError`. This removes the bespoke unreachable function while retaining compile-time coverage. The multi-tag form is specifically supported by Effect's `Match.tag` API.

### 2. Make Canvas arrangement dispatch exhaustive

**Location:** [`src/react/canvas-arrangement.ts`](../../src/react/canvas-arrangement.ts), lines 241–265
**Value:** high
**Confidence:** high

`CanvasArrangementOperation` is a three-member `_tag` union. `makePlan` currently dispatches through a nested ternary whose final branch implicitly means `ArrangeGrid`.

Use `Match.value(request.operation).pipe(Match.tagsExhaustive({...}))` for the `moves` calculation:

```ts
const moves = Match.value(request.operation).pipe(
  Match.tagsExhaustive({
    Align: ({ alignment }) => align(alignment, request.items),
    Distribute: ({ axis }) => distribute(axis, request.items),
    ArrangeGrid: () => arrangeGrid(request.items)
  })
)
```

Keep `requiredItemCount` as its simple ternary unless the minimum becomes variant-specific beyond the current `Distribute` exception. Using `Match` for that two-value expression would be noisier.

### 3. Exhaustively handle Frame input intents

**Locations:** [`src/frame-bridge/input-relay.ts`](../../src/frame-bridge/input-relay.ts), lines 3–35; [`src/react/canvas-viewport.tsx`](../../src/react/canvas-viewport.tsx), lines 1232–1284
**Value:** high
**Confidence:** high

`FrameInputIntent` has six `type` variants. The Frame card callback handles them with a six-branch `if`/`else if` chain and no final exhaustiveness assertion. A newly added intent can currently reach this site without forcing an update if its fields are not otherwise referenced.

Wrap the handler body with:

```ts
Match.value(intent).pipe(
  Match.discriminatorsExhaustive("type")({
    select: (intent) => { /* current select branch */ },
    delete: (intent) => { /* current delete branch */ },
    tool: (intent) => { /* current tool branch */ },
    "zoom-step": (intent) => { /* current zoom branch */ },
    pinch: (intent) => { /* current pinch branch */ },
    wheel: (intent) => { /* current wheel branch */ }
  })
)
```

This is more valuable than merely shortening the conditionals: it makes the bridge schema and Canvas consumer evolve together.

### 4. Make camera input dispatch exhaustive

**Location:** [`src/react/canvas-camera.ts`](../../src/react/canvas-camera.ts), lines 194–287
**Value:** high
**Confidence:** high

`CanvasCameraInput` has six `type` variants. `updateCanvasCamera` handles five explicitly, then treats the remaining input as `wheel`. `Match.discriminatorsExhaustive("type")` would make all six branches visible and keep per-variant narrowing local.

The branch bodies are substantial, so use a reusable matcher or small named handlers rather than placing another deeply indented object inline. `options` and `state` can remain closed over by a matcher created inside `updateCanvasCamera`.

The finite wheel behavior validation at lines 106–111 can also use `Match.when(Match.is("none", "pan", "zoom"), ...)`, but only if `Match` is already imported for the larger dispatch; it does not justify an import by itself.

### 5. Replace Canvas control fact ladders with typed dispatch

**Location:** [`src/react/canvas-controls.ts`](../../src/react/canvas-controls.ts), lines 689–728
**Value:** high
**Confidence:** high

`FactRequirement` is a four-member union discriminated by `source`, but `factValue` handles it through sequential checks and then repeats every permitted request/target fact name. This is a strong combined `Match` and `Predicate` candidate.

Use `Match.value(requirement).pipe(Match.discriminatorsExhaustive("source")({...}))` to make all four sources explicit. For the `request` and `target` branches, use one dynamic boolean-fact reader:

```ts
const booleanFact = (request: CanvasActionRequest, fact: string) => {
  if (
    Predicate.hasProperty(request, fact) &&
    Predicate.isBoolean(request[fact])
  ) return request[fact]
  throw new TypeError(`Action ${request.id} does not supply fact ${fact}`)
}
```

Keep distinct request/target error wording if it is user- or test-observable. This change removes the eight-name ladder, remains safe if a future request field is present but not boolean, and makes a new `FactRequirement.source` a compile error at the resolver.

This is runtime policy evaluation over values already described by `CanvasActionRequest` and `AvailabilityGuard` Schemas. Keep those Schemas; `Predicate` is only narrowing the property selected dynamically after the boundary/type contract has been established.

### 6. Centralize HTTP tagged-union dispatch

**Location:** [`src/http/contract.ts`](../../src/http/contract.ts), lines 205–215, 268–390
**Value:** high
**Confidence:** high for error mapping; medium-high for full route dispatch

There are three related opportunities:

- `clientErrorResponse` maps the four `CritClientError` variants to status codes. `Match.valueTags` or `Match.tagsExhaustive` removes the three `instanceof` checks and makes the mapping exhaustive.
- The PATCH error handler at lines 360–384 receives a closed union of tagged errors. Match its `_tag` values instead of using a four-class OR followed by nested ternaries.
- `CritHttpRoute` has five `_tag` variants, but `makeCritHttpHandler` handles four and lets `Canvas` fall through into method dispatch. A `Match.valueTags(route, {...})` dispatch would make `Canvas` explicit and require new routes to be wired.

The route rewrite is larger because each handler returns an `Effect`; extract per-route functions first so the matcher remains a readable dispatch table. Do not combine HTTP method dispatch into the same matcher—methods are ordinary string conditions local to each route.

### 7. Make Comment Thread action dispatch exhaustive

**Location:** [`src/session/comment-thread-review.ts`](../../src/session/comment-thread-review.ts), lines 286–400
**Value:** high
**Confidence:** medium-high

`CommentThreadReviewAction` is a three-member `type` union. `perform` handles `edit`, then `set-resolved`, then uses `if (action.type !== "submit")` as a defensive branch before treating the remaining action as submit. After the shared idle/pending/author preconditions, use `Match.discriminatorsExhaustive("type")` for the three action bodies.

This improves the state machine's change safety, but the handlers are long. Extract `performEdit`, `performResolution`, and `performSubmit` closures first or during the change; an inline 110-line matcher would not be a cleanup.

## Medium-confidence `Match` changes

### Frame comment bridge event dispatch

**Location:** [`src/react/frame-card.tsx`](../../src/react/frame-card.tsx), lines 469–489
**Value:** medium
**Confidence:** high

`FrameCommentEvent` has `ready`, `select`, and `open` variants. The callback's final `else` implicitly means `open`. `Match.discriminatorsExhaustive("type")` makes the protocol consumer track the Schema union. This is small enough to include with the Frame input-intent work.

### Transition presentation in the Canvas viewport

**Location:** [`src/react/canvas-viewport.tsx`](../../src/react/canvas-viewport.tsx), lines 405–475
**Value:** medium
**Confidence:** medium

`CommentThreadReviewTransition` is a `type` union (`changed`, `blocked`, `dispatch`). The current code performs several partial checks in `adopt`, `presentCommentReview`, and `presentOrReport`. A reusable type matcher can make transition presentation easier to audit, but the dirty-draft confirmation deliberately cuts across the union and one specific reason. Refactor only after the action state machine above; do not force every partial check into a matcher.

### Unknown exception dispatch in the Vite adapter

**Location:** [`src/vite/index.ts`](../../src/vite/index.ts), lines 716–730
**Value:** low-medium
**Confidence:** high

The Frame relay catch has two class-specific cases and a fallback. `Match.value(cause)` with two `Match.when(Match.instanceOf(...))` cases and `Match.orElse` is valid and reads consistently with other dispatch code, but it is not more exhaustive because the input is `unknown`. Adopt it only if the surrounding HTTP error matching establishes a repository convention.

## Large candidate that needs a preparatory refactor

### Canvas command application

**Location:** [`src/core/canvas.ts`](../../src/core/canvas.ts), lines 558–983
**Value:** potentially very high
**Confidence:** medium

This is the largest discriminated-union dispatcher: 27 `CanvasCommand` variants are handled through top-level tag checks, grouped OR checks, nested tag chains, and a final implicit “remaining commands are Note commands” section. The final fall-through is the important risk: a future command with a compatible `id` shape could enter the Note path unless another field access happens to produce a compiler error.

Do **not** mechanically replace this with one 400-line `Match.valueTags` object. That preserves the depth and adds matcher syntax.

Instead:

1. Extract cohesive handlers for Canvas metadata/additions, Frame mutations, Comment Thread mutations, and Note mutations.
2. Give each handler a narrowed command union and keep shared lookup/marking behavior inside that handler.
3. Use a top-level exhaustive `Match.typeTags<CanvasCommand, void>()({...})` dispatch table, with each tag delegating to the appropriate small handler.
4. Preserve the existing atomic draft mutation and `CanvasCommandFailed` conversion exactly.

This is worthwhile architecture work, but it should be a dedicated change with focused tests, not part of the first Predicate/Match cleanup batch.

## `Predicate` opportunities

### 1. Collapse the Canvas action interpolation whitelist

**Location:** [`src/react/canvas-controls.ts`](../../src/react/canvas-controls.ts), lines 730–785
**Value:** medium-high
**Confidence:** high

`interpolate` has a ten-branch equality ladder that returns `values[key]` for every key in `templateValues`. It must be updated manually whenever a new template value is added. The values object is internal and all its members are strings, so a checked dynamic lookup is clearer:

```ts
if (
  Predicate.hasProperty(values, key) &&
  Predicate.isString(values[key])
) return values[key]
throw new TypeError(`Unknown Canvas action template value: ${key}`)
```

This retains rejection of unknown/non-string placeholders and automatically follows `ReturnType<typeof templateValues>`. `Predicate.hasProperty` uses the JavaScript `in` operator rather than an own-property check; that is acceptable for this fixed internal object because inherited built-ins are not strings. If templates ever become externally supplied, validate the placeholder/key contract at that new boundary instead of relying on this lookup.

### 2. Replace handwritten `undefined` refinements

**Locations:** [`src/react/crit.tsx`](../../src/react/crit.tsx), lines 100–101; [`src/node/file-system-canvas-repository.ts`](../../src/node/file-system-canvas-repository.ts), lines 170–177
**Value:** small but clear
**Confidence:** high

Both callbacks exist only to convince TypeScript that filtered values are defined:

```ts
values.filter(Predicate.isNotUndefined)
documents.filter(Predicate.isNotUndefined)
```

Both files already import from `effect`, so this is a low-cost direct use of the v4 refinement.

### 3. Consolidate unknown-cause message extraction

**Locations:** 27 occurrences across 14 files, including [`src/cli/command.ts`](../../src/cli/command.ts), [`src/http/client.ts`](../../src/http/client.ts), [`src/core/canvas.ts`](../../src/core/canvas.ts), and [`src/runtime/canvas-failure.ts`](../../src/runtime/canvas-failure.ts)
**Value:** medium-high if centralized; none as isolated substitutions
**Confidence:** medium

The repeated pattern is:

```ts
cause instanceof Error ? cause.message : String(cause)
```

Changing each occurrence to `Predicate.isError(cause)` is not shorter. The cleanup is to introduce one shared helper whose implementation uses `Predicate.isError`, with an optional fallback policy for the sites that intentionally do not stringify unknown values:

```ts
const causeMessage = (cause: unknown, fallback?: string) =>
  Predicate.isError(cause) ? cause.message : fallback ?? String(cause)
```

Before implementing, choose and document the seam: a browser-safe shared runtime utility is preferable to importing a Node helper into UI code. Keep Schema parse errors that deliberately use `String(cause)` unchanged; they often carry richer formatter output than `Error.message`.

### 4. Keep the existing selector refinement

**Location:** [`src/frame-bridge/input-relay.ts`](../../src/frame-bridge/input-relay.ts), lines 295–299
**Assessment:** already a good `Predicate` use

`isSelectorTarget` correctly combines `Predicate.hasProperty` and `Predicate.isFunction` to refine an `EventTarget | null`. `Predicate.Struct({ matches: Predicate.isFunction })` is not a safe drop-in for nullable input and would obscure the important object/property guard. Leave it as written.

## Tempting replacements that should remain plain TypeScript

- **Schema decoding at I/O boundaries.** `frame-bridge/comment-bridge.ts`, `http/client.ts`, `http/contract.ts`, IndexedDB, manifests, and CLI JSON should keep `Schema.decodeUnknown*`. The `CanvasActionRequest` and guard Schemas in `canvas-controls.ts` should also remain even if their internal dynamic fact lookup uses `Predicate`. `Predicate` answers yes/no; it does not decode, normalize, or produce structured failure information.
- **Embedded Frame Bridge JavaScript.** The script string in `frame-bridge/comment-bridge.ts` runs as a self-contained injected browser program and cannot import Effect modules. Its defensive property checks and normalization must remain dependency-free; only the typed host-side bridge is in scope for Effect helpers.
- **DOM realm checks.** `instanceof Element`, `HTMLElement`, `Node`, and form element checks in React/playground code communicate browser semantics directly. `Match.instanceOf` or `Predicate` wrappers would not add safety and can retain the same cross-realm limitation.
- **Domain-named refinements.** `isFrame` in [`src/react/canvas-interaction.ts`](../../src/react/canvas-interaction.ts), line 119, and `isFrameReviewStatus` in [`src/react/frame-chrome.tsx`](../../src/react/frame-chrome.tsx), lines 202–204, express domain meaning better than `Predicate.hasProperty("url")` or a negated literal predicate.
- **Geometry and keyboard membership checks.** Handle direction groups in `canvas-selection.tsx`, modifier/key checks in `input-relay.ts`, protocol checks, and two-branch flags are clearer as direct booleans. `Match.is` is useful when it also narrows a reusable finite set, not as a blanket replacement for `a === x || a === y`.
- **JSX rendering branches.** `_tag` checks in `canvas-help.tsx`, artwork-kind checks in `canvas-selection.tsx`, and presence/absence rendering are local view conditions. Wrapping each in `Match` would fragment the JSX.
- **AST tooling.** The `tools/oxlint/anti-slop` rules branch directly on ESTree node types. Adding an Effect runtime dependency to lint-rule internals for short AST checks would increase coupling and does not improve the rules' exhaustiveness.
- **Tests.** Direct tag checks in assertions and `.filter` calls are usually the expected behavior being tested. Matchers would hide intent and make failures less obvious. Use the production matcher through public behavior tests instead.
- **Synth playground.** Literal guards in `playground/src/frame-page.tsx` are small and self-contained; no synth change is recommended.

## Suggested verification for an implementation pass

For each batch:

1. Run `npm run typecheck` first; the primary benefit is compile-time exhaustiveness.
2. Run the focused tests for the changed domain (`canvas-failure`, arrangement, camera, input relay/viewport, HTTP, or Comment Thread Review).
3. Run the full test suite and production build.
4. For client-side `Match` adoption, compare the built asset sizes once. Effect declares the package side-effect-free, but the actual bundler output is the relevant regression check.

## Primary sources

- [Effect v4 `Match.ts` at `effect@4.0.0-rc.109`](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.109/packages/effect/src/Match.ts)
- [Effect v4 `Predicate.ts` at `effect@4.0.0-rc.109`](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.109/packages/effect/src/Predicate.ts)
- [Effect `effect@4.0.0-rc.109` release](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-rc.109)
- Installed package metadata: `node_modules/effect/package.json` (`version: 4.0.0-rc.109`, `sideEffects: []`)
