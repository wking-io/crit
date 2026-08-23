import {
  CanvasEngine,
  CanvasProjection,
  DomainValue,
  Id,
  IsoTimestamp,
  decodeCanvasCommandBatch,
  emptyCanvasProjection
} from "@crit/domain"
import { ProtocolValue, type ProposedCanvasChange } from "@crit/protocol"
import { Data, Deferred, Effect, Exit, Fiber, Layer, Result, Schema, type Scope } from "effect"

import {
  AuthorityModel,
  AgentInvocation,
  CanvasAuthority,
  PersonInvocation,
  VerifiedInvocation
} from "./index.js"

export interface AuthorityConformanceOptions {
  readonly now?: Effect.Effect<typeof IsoTimestamp.Type>
}

export type AuthorityConformanceFactory = (
  options?: AuthorityConformanceOptions
) => Layer.Layer<CanvasAuthority, never, Scope.Scope>

const provideAuthority = <A, E, R>(
  factory: AuthorityConformanceFactory,
  options: AuthorityConformanceOptions | undefined,
  program: Effect.Effect<A, E, R | CanvasAuthority>
): Effect.Effect<A, E, Exclude<R, CanvasAuthority> | Scope.Scope> =>
  program.pipe(Effect.provide(factory(options)))

export interface AuthorityConformanceScenario {
  readonly name: string
  readonly run: Effect.Effect<void, unknown, Scope.Scope>
}

export class AuthorityConformanceFailure extends Data.TaggedError(
  "AuthorityConformanceFailure"
)<{
  readonly scenario: string
  readonly message: string
}> {}

const canvasA = Id.canvas("canvas_conformance_a")
const canvasB = Id.canvas("canvas_conformance_b")
const limit = AuthorityModel.pageLimit(100)
const person = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "oidc|conformance",
    person: { _tag: "person", personId: "person_conformance", displayName: "Conformance" }
  }
})
const agent = Schema.decodeUnknownSync(AgentInvocation)({
  _tag: "agent",
  principal: {
    _tag: "agent",
    subject: "oauth|conformance",
    agent: { _tag: "agent", agentId: "agent_conformance", displayName: "Conformance Agent" },
    delegatedBy: person.principal.person,
    oauthClientId: "oauth_client_conformance",
    grantId: "grant_conformance"
  },
  executionId: "execution_conformance",
  reportedRuntime: {
    _tag: "reported-runtime",
    source: "client-reported",
    harness: { name: "Conformance Harness" },
    model: { provider: "test", name: "reference" }
  }
})

const create = (authority: CanvasAuthority["Service"], canvasId = canvasA) => authority.create({
  _tag: "create-canvas",
  canvasId,
  title: "Authority"
}, person)

const rename = (expectedTitle: string, title: string) => decodeCanvasCommandBatch([{
  _tag: "rename-canvas",
  expectedTitle,
  title
}])

const proposal = (
  changeId: string,
  commands: ReturnType<typeof rename>,
  canvasId = canvasA,
  observedCursor: ProposedCanvasChange["observedCursor"] = null
): ProposedCanvasChange => ({
  changeId: Id.change(changeId),
  canvasId,
  observedCursor,
  commands
})

const requireScenario = (scenario: string, condition: boolean, message: string): void => {
  if (!condition) throw new AuthorityConformanceFailure({ scenario, message })
}

const renamedTitle = (proposalValue: ProposedCanvasChange): string | undefined => {
  const first = proposalValue.commands[0]
  return first?._tag === "rename-canvas" ? first.title : undefined
}

const failureTag = <A, E extends { readonly _tag: string }>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.result(effect), (result) => result._tag === "Failure" ? result.failure._tag : "success")

const isolationScenario = (factory: AuthorityConformanceFactory): AuthorityConformanceScenario => {
  const name = "owns ingress and egress graphs"
  return {
    name,
    run: provideAuthority(factory, undefined, Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const incomingInvocation = DomainValue.detach(person)
      const created = yield* authority.create({
        _tag: "create-canvas", canvasId: canvasA, title: "Authority"
      }, incomingInvocation)
      const incoming = proposal("change_conformance_mutation", rename("Authority", "Review"))
      const receipt = yield* authority.submit(incoming, incomingInvocation)
      const page = yield* authority.changesAfter({ _tag: "changes-after", canvasId: canvasA, after: null, limit })
      Reflect.set(incoming.commands[0], "title", "mutated input")
      Reflect.set(incomingInvocation.principal.person, "displayName", "mutated invocation")
      Reflect.set(created.projection, "title", "mutated view")
      Reflect.set(receipt.change.commands[0], "title", "mutated receipt")
      const returned = page.changes[0]
      requireScenario(name, returned !== undefined, "accepted change missing from page")
      if (returned !== undefined) Reflect.set(returned.commands[0], "title", "mutated page")
      const retry = yield* authority.submit(
        proposal("change_conformance_mutation", rename("Authority", "Review")),
        person
      )
      const stored = yield* authority.changesAfter({ _tag: "changes-after", canvasId: canvasA, after: null, limit })
      const view = yield* authority.open(canvasA)
      requireScenario(name, renamedTitle(retry.change) === "Review", "retry identity was mutated")
      requireScenario(name, stored.changes[0] !== undefined && renamedTitle(stored.changes[0]) === "Review", "ledger was mutated")
      requireScenario(name, view.projection.title === "Review", "checkpoint was mutated")
      requireScenario(
        name,
        view.createdBy._tag === "person" && view.createdBy.person.displayName === "Conformance",
        "creation or submission invocation was mutated"
      )
    }))
  }
}

const scopedIdentityScenario = (factory: AuthorityConformanceFactory): AuthorityConformanceScenario => {
  const name = "scopes retry and cursor identity"
  return {
    name,
    run: provideAuthority(factory, undefined, Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const left = yield* create(authority)
      yield* create(authority, canvasB)
      const commands = rename("Authority", "Review")
      const first = yield* authority.submit(proposal("change_conformance_shared", commands), person)
      const second = yield* authority.submit(proposal("change_conformance_shared", commands, canvasB), person)
      requireScenario(name, first.change.sequence === 1 && second.change.sequence === 1, "change IDs leaked across Canvases")
      const foreign = yield* failureTag(authority.submit(proposal(
        "change_conformance_cursor",
        rename("Review", "Final"),
        canvasA,
        ProtocolValue.cursor("cursor_foreign")
      ), person))
      requireScenario(name, foreign === "cursor-not-found", "unknown cursor was accepted")
      const accepted = yield* authority.submit(proposal(
        "change_conformance_cursor", rename("Review", "Final"), canvasA, left.cursor
      ), person)
      requireScenario(name, accepted.change.sequence === 2, "cursor failure reserved identity or sequence")
    }))
  }
}

const rejectedRetryScenario = (factory: AuthorityConformanceFactory): AuthorityConformanceScenario => {
  const name = "reserves exact engine rejection"
  return {
    name,
    run: provideAuthority(factory, undefined, Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      yield* create(authority)
      const rejected = proposal("change_conformance_rejected", rename("Wrong", "Review"))
      const first = yield* Effect.result(authority.submit(rejected, person))
      const retry = yield* Effect.result(authority.submit(rejected, person))
      requireScenario(name, Result.isFailure(first) && first.failure._tag === "change-rejected", "engine rejection was not typed")
      requireScenario(name, Result.isFailure(retry) && retry.failure._tag === "change-rejected", "exact rejection retry changed")
      const changed = yield* failureTag(authority.submit(
        proposal("change_conformance_rejected", rename("Authority", "Review")), person
      ))
      requireScenario(name, changed === "change-id-reused", "rejected retry identity was not reserved")
    }))
  }
}

const failedCreateClockScenario = (factory: AuthorityConformanceFactory): AuthorityConformanceScenario => {
  const name = "failed creation clock is atomic"
  return {
    name,
    run: Effect.gen(function*() {
      let reads = 0
      const timestamp = Schema.decodeUnknownSync(IsoTimestamp)("2026-08-21T12:00:00.000Z")
      const now = Effect.suspend(() => {
        reads += 1
        return reads === 1 ? Effect.die("clock failed") : Effect.succeed(timestamp)
      })
      yield* provideAuthority(factory, { now }, Effect.gen(function*() {
        const authority = yield* CanvasAuthority
        const failed = yield* Effect.exit(create(authority))
        requireScenario(name, Exit.isFailure(failed), "first creation did not fail with the clock defect")
        const created = yield* create(authority)
        requireScenario(name, created.canvasId === canvasA && reads === 2, "failed clock reserved Canvas creation")
      }))
    })
  }
}

const interruptedSubmitScenario = (factory: AuthorityConformanceFactory): AuthorityConformanceScenario => {
  const name = "interrupted submission is atomic"
  return {
    name,
    run: Effect.gen(function*() {
      let reads = 0
      const enteredClock = yield* Deferred.make<void>()
      const timestamp = Schema.decodeUnknownSync(IsoTimestamp)("2026-08-21T12:00:00.000Z")
      const now = Effect.suspend(() => {
        reads += 1
        return reads === 2
          ? Deferred.succeed(enteredClock, undefined).pipe(Effect.andThen(Effect.never))
          : Effect.succeed(timestamp)
      })
      yield* provideAuthority(factory, { now }, Effect.gen(function*() {
        const authority = yield* CanvasAuthority
        yield* create(authority)
        const submitted = proposal("change_conformance_interrupted", rename("Authority", "Review"))
        const fiber = yield* Effect.forkChild(authority.submit(submitted, person))
        yield* Deferred.await(enteredClock)
        yield* Fiber.interrupt(fiber)
        const receipt = yield* authority.submit(submitted, person)
        requireScenario(name, receipt.change.sequence === 1 && reads === 3, "interruption reserved or advanced submission")
      }))
    })
  }
}

const ledgerScenario = (factory: AuthorityConformanceFactory): AuthorityConformanceScenario => {
  const name = "orders, pages, attributes, replays, and creates atomically"
  return {
    name,
    run: provideAuthority(factory, undefined, Effect.gen(function*() {
      const raced = yield* CanvasAuthority
      const creations = yield* Effect.all(
        Array.from({ length: 8 }, () => Effect.result(create(raced, canvasB))),
        { concurrency: "unbounded" }
      )
      requireScenario(name, creations.filter(Result.isSuccess).length === 1, "create race had multiple winners")

      const authority = raced
      yield* create(authority)
      const submissions = Array.from({ length: 6 }, (_, index) => authority.submit(proposal(
        `change_conformance_note_${index}`,
        decodeCanvasCommandBatch([{
          _tag: "add-note",
          noteId: `note_conformance_${index}`,
          text: `Note ${index}`,
          geometry: { x: index, y: 0, width: 10, height: 10 },
          attachedFrameId: null
        }])
      ), index === 0 ? agent : person))
      yield* Effect.all(submissions, { concurrency: "unbounded" })
      const first = yield* authority.changesAfter({
        _tag: "changes-after", canvasId: canvasA, after: null, limit: AuthorityModel.pageLimit(2)
      })
      const second = yield* authority.changesAfter({
        _tag: "changes-after", canvasId: canvasA, after: first.cursor, limit: AuthorityModel.pageLimit(4)
      })
      const history = [...first.changes, ...second.changes]
      requireScenario(name, history.every((change, index) => change.sequence === index + 1), "sequence was not gap-free")
      requireScenario(name, first.hasMore && !second.hasMore, "paging continuation was incorrect")
      requireScenario(name, history[0]?.attribution._tag === "agent", "Agent submission lost attribution")
      const view = yield* authority.open(canvasA)
      const replay = CanvasEngine.replay(emptyCanvasProjection(canvasA, "Authority"), history)
      requireScenario(
        name,
        replay._tag === "replayed" && Schema.toEquivalence(CanvasProjection)(replay.projection, view.projection),
        "replayed projection did not match checkpoint"
      )
    }))
  }
}

const lifecycleScenario = (factory: AuthorityConformanceFactory): AuthorityConformanceScenario => {
  const name = "creates provenance and preserves lifecycle failures"
  return {
    name,
    run: provideAuthority(factory, undefined, Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const missingProposal = proposal("change_conformance_missing", rename("Authority", "Review"))
      requireScenario(name, (yield* failureTag(authority.open(canvasA))) === "canvas-not-found", "open did not report missing Canvas")
      requireScenario(name, (yield* failureTag(authority.submit(missingProposal, person))) === "canvas-not-found", "submit did not report missing Canvas")
      requireScenario(name, (yield* failureTag(authority.changesAfter({
        _tag: "changes-after", canvasId: canvasA, after: null, limit
      }))) === "canvas-not-found", "page did not report missing Canvas")
      const original = yield* create(authority)
      const duplicate = yield* failureTag(authority.create({
        _tag: "create-canvas", canvasId: canvasA, title: "Replacement"
      }, agent))
      requireScenario(name, duplicate === "canvas-already-exists", "duplicate creation was accepted")
      const opened = yield* authority.open(canvasA)
      requireScenario(name, opened.createdBy._tag === "person" && opened.projection.title === "Authority", "duplicate creation replaced provenance")
      const empty = yield* authority.changesAfter({ _tag: "changes-after", canvasId: canvasA, after: null, limit })
      requireScenario(name, empty.changes.length === 0 && empty.cursor === original.cursor, "creation synthesized ledger history")
    }))
  }
}

const acceptedRetryScenario = (factory: AuthorityConformanceFactory): AuthorityConformanceScenario => {
  const name = "stabilizes accepted retries by authorization subject"
  return {
    name,
    run: provideAuthority(factory, undefined, Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const view = yield* create(authority)
      const original = proposal("change_conformance_retry", rename("Authority", "Review"), canvasA, view.cursor)
      const first = yield* authority.submit(original, agent)
      const retry = yield* authority.submit(original, agent)
      requireScenario(name, first.disposition === "first-acceptance", "first submission had retry disposition")
      requireScenario(name, retry.disposition === "identical-retry", "retry disposition was not preserved")
      requireScenario(name, retry.change.cursor === first.change.cursor && retry.change.acceptedAt === first.change.acceptedAt, "retry was restamped")
      const changedSubject = Schema.decodeUnknownSync(VerifiedInvocation)({
        ...agent,
        principal: { ...agent.principal, subject: "oauth|changed" }
      })
      const changedRuntime = Schema.decodeUnknownSync(VerifiedInvocation)({
        ...agent,
        reportedRuntime: { ...agent.reportedRuntime, model: { provider: "test", name: "changed" } }
      })
      for (const [changedProposal, changedInvocation] of [
        [{ ...original, observedCursor: null }, agent],
        [{ ...original, commands: rename("Authority", "Other") }, agent],
        [original, changedSubject]
      ] as const) {
        requireScenario(
          name,
          (yield* failureTag(authority.submit(changedProposal, changedInvocation))) === "change-id-reused",
          "changed retry fact was accepted"
        )
      }
      const metadataRetry = yield* authority.submit(original, changedRuntime)
      requireScenario(name, metadataRetry.disposition === "identical-retry", "metadata refresh invalidated retry")
      requireScenario(
        name,
        metadataRetry.change.attribution._tag === "agent" &&
          metadataRetry.change.attribution.reportedRuntime?.model?.name === "reference",
        "metadata refresh restamped the accepted change"
      )
    }))
  }
}

const cursorPagingScenario = (factory: AuthorityConformanceFactory): AuthorityConformanceScenario => {
  const name = "accepts old cursors and returns stable empty continuations"
  return {
    name,
    run: provideAuthority(factory, undefined, Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const genesis = yield* create(authority)
      const other = yield* create(authority, canvasB)
      const first = yield* authority.submit(proposal("change_conformance_old_a", rename("Authority", "Review"), canvasA, genesis.cursor), person)
      const second = yield* authority.submit(proposal("change_conformance_old_b", rename("Review", "Final"), canvasA, genesis.cursor), person)
      requireScenario(name, second.change.sequence === 2, "old known cursor was rejected")
      requireScenario(name, (yield* failureTag(authority.changesAfter({
        _tag: "changes-after", canvasId: canvasA, after: other.cursor, limit
      }))) === "cursor-not-found", "foreign cursor was accepted")
      const page = yield* authority.changesAfter({
        _tag: "changes-after", canvasId: canvasA, after: first.change.cursor, limit
      })
      requireScenario(name, page.changes.length === 1 && page.cursor === second.change.cursor, "continuation page was incorrect")
      const empty = yield* authority.changesAfter({
        _tag: "changes-after", canvasId: canvasA, after: page.cursor, limit
      })
      requireScenario(name, empty.changes.length === 0 && empty.cursor === page.cursor && !empty.hasMore, "empty continuation cursor changed")
    }))
  }
}

const atomicConflictScenario = (factory: AuthorityConformanceFactory): AuthorityConformanceScenario => {
  const name = "keeps engine rejection atomic without consuming authority values"
  return {
    name,
    run: Effect.gen(function*() {
      let reads = 0
      const now = Effect.sync(() => {
        const value = Schema.decodeUnknownSync(IsoTimestamp)(new Date(Date.UTC(2026, 7, 21, 12, 0, reads)).toISOString())
        reads += 1
        return value
      })
      yield* provideAuthority(factory, { now }, Effect.gen(function*() {
        const authority = yield* CanvasAuthority
        const genesis = yield* create(authority)
        const conflict: ProposedCanvasChange = {
          changeId: Id.change("change_conformance_atomic"),
          canvasId: canvasA,
          observedCursor: null,
          commands: decodeCanvasCommandBatch([
            { _tag: "rename-canvas", expectedTitle: "Authority", title: "Review" },
            { _tag: "rename-canvas", expectedTitle: "Authority", title: "Final" }
          ])
        }
        requireScenario(name, (yield* failureTag(authority.submit(conflict, person))) === "change-rejected", "atomic conflict was accepted")
        requireScenario(name, (yield* failureTag(authority.submit(conflict, person))) === "change-rejected", "rejected retry changed")
        const accepted = yield* authority.submit(proposal("change_conformance_after_reject", rename("Authority", "Review")), person)
        const view = yield* authority.open(canvasA)
        requireScenario(name, reads === 2 && accepted.change.sequence === 1, "rejection or retry consumed clock or sequence")
        requireScenario(name, view.projection.title === "Review" && genesis.cursor !== accepted.change.cursor, "conflict mutated checkpoint or cursor")
      }))
    })
  }
}

export const authorityConformanceScenarios = (
  factory: AuthorityConformanceFactory
): readonly AuthorityConformanceScenario[] => [
  isolationScenario(factory),
  scopedIdentityScenario(factory),
  rejectedRetryScenario(factory),
  failedCreateClockScenario(factory),
  interruptedSubmitScenario(factory),
  ledgerScenario(factory),
  lifecycleScenario(factory),
  acceptedRetryScenario(factory),
  cursorPagingScenario(factory),
  atomicConflictScenario(factory)
]
