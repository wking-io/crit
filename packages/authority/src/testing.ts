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
import { Data, Deferred, Effect, Exit, Fiber, Layer, Match, Predicate, Result, Schema, type Scope } from "effect"

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
    person: {
      _tag: "person",
      personId: "person_conformance",
      displayName: "Conformance",
      email: { _tag: "unspecified" }
    }
  }
})
const agent = Schema.decodeUnknownSync(AgentInvocation)({
  _tag: "agent",
  principal: {
    _tag: "agent",
    subject: "local-agent|conformance",
    agent: { _tag: "agent", agentId: "agent_conformance", displayName: "Conformance Agent" },
    delegatedBy: person.principal.person
  },
  executionId: "execution_conformance",
  reportedRuntime: {
    _tag: "reportedRuntime",
    source: "client-reported",
    harness: { name: "Conformance Harness" },
    model: { provider: "test", name: "reference" }
  }
})

const create = (authority: CanvasAuthority["Service"], canvasId = canvasA) => authority.create({
  _tag: "createCanvas",
  canvasId,
  title: "Authority"
}, person)

const rename = (expectedTitle: string, title: string) => decodeCanvasCommandBatch([{
  _tag: "renameCanvas",
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
  if (first === undefined) return undefined
  return Match.value(first).pipe(
    Match.tag("renameCanvas", ({ title }) => title),
    Match.orElse(() => undefined)
  )
}

const isFailureTag = <A, E>(effect: Effect.Effect<A, E>, tag: string) =>
  Effect.map(Effect.result(effect), (result) =>
    Result.isFailure(result) && Predicate.isTagged(result.failure, tag)
  )

const isolationScenario = (factory: AuthorityConformanceFactory): AuthorityConformanceScenario => {
  const name = "owns ingress and egress graphs"
  return {
    name,
    run: provideAuthority(factory, undefined, Effect.gen(function*() {
      const authority = yield* CanvasAuthority
      const incomingInvocation = DomainValue.detach(person)
      const created = yield* authority.create({
        _tag: "createCanvas", canvasId: canvasA, title: "Authority"
      }, incomingInvocation)
      const incoming = proposal("change_conformance_mutation", rename("Authority", "Review"))
      const receipt = yield* authority.submit(incoming, incomingInvocation)
      const page = yield* authority.changesAfter({ _tag: "changesAfter", canvasId: canvasA, after: null, limit })
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
      const stored = yield* authority.changesAfter({ _tag: "changesAfter", canvasId: canvasA, after: null, limit })
      const view = yield* authority.open(canvasA)
      requireScenario(name, renamedTitle(retry.change) === "Review", "retry identity was mutated")
      requireScenario(name, stored.changes[0] !== undefined && renamedTitle(stored.changes[0]) === "Review", "ledger was mutated")
      requireScenario(name, view.projection.title === "Review", "checkpoint was mutated")
      requireScenario(
        name,
        Match.value(view.createdBy).pipe(
          Match.tag("person", ({ person }) => person.displayName === "Conformance"),
          Match.orElse(() => false)
        ),
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
      requireScenario(name, yield* isFailureTag(authority.submit(proposal(
        "change_conformance_cursor",
        rename("Review", "Final"),
        canvasA,
        ProtocolValue.cursor("cursor_foreign")
      ), person), "cursorNotFound"), "unknown cursor was accepted")
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
      requireScenario(name, Result.isFailure(first) && Predicate.isTagged(first.failure, "changeRejected"), "engine rejection was not typed")
      requireScenario(name, Result.isFailure(retry) && Predicate.isTagged(retry.failure, "changeRejected"), "exact rejection retry changed")
      requireScenario(name, yield* isFailureTag(authority.submit(
        proposal("change_conformance_rejected", rename("Authority", "Review")), person
      ), "changeIdReused"), "rejected retry identity was not reserved")
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
        `change_conformance_frame_${index}`,
        decodeCanvasCommandBatch([{
          _tag: "addFrame",
          frameId: `frame_conformance_${index}`,
          title: `Frame ${index}`,
          representation: { _tag: "webUrl", url: `https://example.com/${index}` },
          status: "in-progress",
          geometry: { x: index, y: 0, width: 10, height: 10 }
        }])
      ), index === 0 ? agent : person))
      yield* Effect.all(submissions, { concurrency: "unbounded" })
      const first = yield* authority.changesAfter({
        _tag: "changesAfter", canvasId: canvasA, after: null, limit: AuthorityModel.pageLimit(2)
      })
      const second = yield* authority.changesAfter({
        _tag: "changesAfter", canvasId: canvasA, after: first.cursor, limit: AuthorityModel.pageLimit(4)
      })
      const history = [...first.changes, ...second.changes]
      requireScenario(name, history.every((change, index) => change.sequence === index + 1), "sequence was not gap-free")
      requireScenario(name, first.hasMore && !second.hasMore, "paging continuation was incorrect")
      requireScenario(name, Predicate.isTagged(history[0]?.attribution, "agent"), "Agent submission lost attribution")
      const view = yield* authority.open(canvasA)
      const replay = CanvasEngine.replay(
        emptyCanvasProjection(canvasA, "Authority"),
        history
      )
      requireScenario(
        name,
        Match.value(replay).pipe(
          Match.tag("replayed", ({ projection }) => Schema.toEquivalence(CanvasProjection)(projection, view.projection)),
          Match.orElse(() => false)
        ),
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
      requireScenario(name, yield* isFailureTag(authority.open(canvasA), "canvasNotFound"), "open did not report missing Canvas")
      requireScenario(name, yield* isFailureTag(authority.submit(missingProposal, person), "canvasNotFound"), "submit did not report missing Canvas")
      requireScenario(name, yield* isFailureTag(authority.changesAfter({
        _tag: "changesAfter", canvasId: canvasA, after: null, limit
      }), "canvasNotFound"), "page did not report missing Canvas")
      const original = yield* create(authority)
      requireScenario(name, yield* isFailureTag(authority.create({
        _tag: "createCanvas", canvasId: canvasA, title: "Replacement"
      }, agent), "canvasAlreadyExists"), "duplicate creation was accepted")
      const opened = yield* authority.open(canvasA)
      requireScenario(name, Predicate.isTagged(opened.createdBy, "person") && opened.projection.title === "Authority", "duplicate creation replaced provenance")
      const empty = yield* authority.changesAfter({ _tag: "changesAfter", canvasId: canvasA, after: null, limit })
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
        principal: { ...agent.principal, subject: "local-agent|changed" }
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
          yield* isFailureTag(authority.submit(changedProposal, changedInvocation), "changeIdReused"),
          "changed retry fact was accepted"
        )
      }
      const metadataRetry = yield* authority.submit(original, changedRuntime)
      requireScenario(name, metadataRetry.disposition === "identical-retry", "metadata refresh invalidated retry")
      requireScenario(
        name,
        Match.value(metadataRetry.change.attribution).pipe(
          Match.tag("agent", ({ reportedRuntime }) => reportedRuntime?.model?.name === "reference"),
          Match.orElse(() => false)
        ),
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
      requireScenario(name, yield* isFailureTag(authority.changesAfter({
        _tag: "changesAfter", canvasId: canvasA, after: other.cursor, limit
      }), "cursorNotFound"), "foreign cursor was accepted")
      const page = yield* authority.changesAfter({
        _tag: "changesAfter", canvasId: canvasA, after: first.change.cursor, limit
      })
      requireScenario(name, page.changes.length === 1 && page.cursor === second.change.cursor, "continuation page was incorrect")
      const empty = yield* authority.changesAfter({
        _tag: "changesAfter", canvasId: canvasA, after: page.cursor, limit
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
            { _tag: "renameCanvas", expectedTitle: "Authority", title: "Review" },
            { _tag: "renameCanvas", expectedTitle: "Authority", title: "Final" }
          ])
        }
        requireScenario(name, yield* isFailureTag(authority.submit(conflict, person), "changeRejected"), "atomic conflict was accepted")
        requireScenario(name, yield* isFailureTag(authority.submit(conflict, person), "changeRejected"), "rejected retry changed")
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
