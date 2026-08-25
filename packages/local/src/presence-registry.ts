import type { VerifiedInvocation } from "@crit/authority"
import {
  ActiveAgentExecution,
  ConnectedPerson,
  IsoTimestamp,
  PresenceRoster,
  type ActiveAgentExecution as ActiveAgentExecutionType,
  type CanvasId,
  type ConnectedPerson as ConnectedPersonType,
  type PersonSnapshot,
  type PresenceKey,
  type PresenceParticipant,
  presenceKey
} from "@crit/domain"
import {
  PresenceClaimMismatch,
  PresenceLeaseId,
  PresenceLeaseNotFound,
  PresenceLeaseReceipt,
  type PresenceClaim,
  type PresenceLeaseId as PresenceLeaseIdType
} from "@crit/replica/http"
import {
  Clock,
  Context,
  Crypto,
  Effect,
  Layer,
  Match,
  PubSub,
  Schema,
  Stream,
  SynchronizedRef
} from "effect"

export const presenceLeaseTtl = "30 seconds"
const presenceLeaseTtlMillis = 30_000

export const delegatingPerson = (
  invocation: VerifiedInvocation
): PersonSnapshot =>
  Match.value(invocation).pipe(Match.tagsExhaustive({
    person: ({ principal }) => principal.person,
    agent: ({ principal }) => principal.delegatedBy
  }))

const activeAgentExecution = (args: {
  readonly agent: ActiveAgentExecutionType["agent"]
  readonly delegatedBy: PersonSnapshot
  readonly executionId: ActiveAgentExecutionType["executionId"]
  readonly reportedRuntime?: ActiveAgentExecutionType["reportedRuntime"]
}): ActiveAgentExecutionType =>
  args.reportedRuntime === undefined
    ? ActiveAgentExecution.make({
        agent: args.agent,
        delegatedBy: args.delegatedBy,
        executionId: args.executionId
      })
    : ActiveAgentExecution.make({
        agent: args.agent,
        delegatedBy: args.delegatedBy,
        executionId: args.executionId,
        reportedRuntime: args.reportedRuntime
      })

export const presenceParticipantFromClaim = (
  claim: PresenceClaim,
  invocation: VerifiedInvocation
): Effect.Effect<PresenceParticipant, PresenceClaimMismatch> =>
  Match.value(claim).pipe(Match.tagsExhaustive({
    "connected-person": () =>
      Match.value(invocation).pipe(Match.tagsExhaustive({
        person: ({ principal }) => Effect.succeed(
          ConnectedPerson.make({ person: principal.person })
        ),
        agent: () => Effect.fail(new PresenceClaimMismatch({
          message: "An Agent invocation cannot claim connected Person presence"
        }))
      })),
    "active-agent-execution": (agentClaim) =>
      Match.value(invocation).pipe(Match.tagsExhaustive({
        person: ({ principal }) => Effect.succeed(
          agentClaim.reportedRuntime === undefined
            ? activeAgentExecution({
                agent: agentClaim.agent,
                delegatedBy: principal.person,
                executionId: agentClaim.executionId
              })
            : activeAgentExecution({
                agent: agentClaim.agent,
                delegatedBy: principal.person,
                executionId: agentClaim.executionId,
                reportedRuntime: agentClaim.reportedRuntime
              })
        ),
        agent: (agentInvocation) => Effect.succeed(
          agentInvocation.reportedRuntime === undefined
            ? activeAgentExecution({
                agent: agentInvocation.principal.agent,
                delegatedBy: agentInvocation.principal.delegatedBy,
                executionId: agentInvocation.executionId
              })
            : activeAgentExecution({
                agent: agentInvocation.principal.agent,
                delegatedBy: agentInvocation.principal.delegatedBy,
                executionId: agentInvocation.executionId,
                reportedRuntime: agentInvocation.reportedRuntime
              })
        )
      }))
  }))

interface PresenceLease {
  readonly leaseId: PresenceLeaseIdType
  readonly canvasId: CanvasId
  readonly key: PresenceKey
  readonly participant: PresenceParticipant
  readonly expiresAtMillis: number
  readonly revision: number
}

interface RegistryState {
  readonly leases: ReadonlyMap<PresenceLeaseIdType, PresenceLease>
  readonly revision: number
}

interface AnnouncementMutation {
  readonly receipt: typeof PresenceLeaseReceipt.Type
  readonly changedRoster: PresenceRoster | undefined
}

const pair = <Value, State>(
  value: Value,
  state: State
): readonly [Value, State] => [value, state]

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const currentParticipants = (
  leases: ReadonlyMap<PresenceLeaseIdType, PresenceLease>,
  canvasId: CanvasId,
  now: number | undefined
): ReadonlyMap<PresenceKey, PresenceParticipant> => {
  const latest = new Map<PresenceKey, PresenceLease>()
  for (const lease of leases.values()) {
    if (lease.canvasId !== canvasId) continue
    if (now !== undefined && lease.expiresAtMillis <= now) continue
    const existing = latest.get(lease.key)
    if (existing === undefined || existing.revision < lease.revision) {
      latest.set(lease.key, lease)
    }
  }
  return new Map([...latest].map(([key, lease]) => [key, lease.participant]))
}

const rosterFromLeases = (
  leases: ReadonlyMap<PresenceLeaseIdType, PresenceLease>,
  canvasId: CanvasId,
  now?: number
): PresenceRoster => {
  const people: Array<ConnectedPersonType> = []
  const agentRuns: Array<ActiveAgentExecutionType> = []
  for (const participant of currentParticipants(leases, canvasId, now).values()) {
    Match.value(participant).pipe(Match.tagsExhaustive({
      "connected-person": (person) => people.push(person),
      "active-agent-execution": (agentRun) => agentRuns.push(agentRun)
    }))
  }
  people.sort((left, right) =>
    compareText(left.person.displayName, right.person.displayName) ||
    compareText(left.person.personId, right.person.personId)
  )
  agentRuns.sort((left, right) =>
    compareText(left.agent.displayName, right.agent.displayName) ||
    compareText(left.executionId, right.executionId)
  )
  return PresenceRoster.make({
    canvasId,
    people,
    agentRuns
  })
}

const runtimeIdentity = (
  runtime: ActiveAgentExecutionType["reportedRuntime"]
): string => runtime === undefined
  ? ""
  : [
      runtime.harness.name,
      runtime.harness.version ?? "",
      runtime.model?.provider ?? "",
      runtime.model?.name ?? "",
      runtime.model?.version ?? "",
      runtime.sessionId ?? "",
      runtime.taskId ?? ""
    ].join("\u0000")

const rosterSignature = (roster: PresenceRoster): string => [
  ...roster.people.map(({ person }) =>
    `person:${person.personId}\u0000${person.displayName}`
  ),
  ...roster.agentRuns.map((run) => [
    `execution:${run.executionId}`,
    run.agent.agentId,
    run.agent.displayName,
    run.delegatedBy.personId,
    run.delegatedBy.displayName,
    runtimeIdentity(run.reportedRuntime)
  ].join("\u0000"))
].join("\u0001")

const changedRoster = (
  canvasId: CanvasId,
  previous: ReadonlyMap<PresenceLeaseIdType, PresenceLease>,
  next: ReadonlyMap<PresenceLeaseIdType, PresenceLease>
): PresenceRoster | undefined => {
  const before = rosterFromLeases(previous, canvasId)
  const after = rosterFromLeases(next, canvasId)
  return rosterSignature(before) === rosterSignature(after) ? undefined : after
}

export class PresenceRegistry extends Context.Service<PresenceRegistry, {
  readonly announce: (input: {
    readonly canvasId: CanvasId
    readonly participant: PresenceParticipant
    readonly leaseId?: PresenceLeaseIdType
  }) => Effect.Effect<typeof PresenceLeaseReceipt.Type, PresenceLeaseNotFound>
  readonly depart: (input: {
    readonly canvasId: CanvasId
    readonly leaseId: PresenceLeaseIdType
  }) => Effect.Effect<void>
  readonly roster: (canvasId: CanvasId) => Effect.Effect<PresenceRoster>
  readonly watch: (canvasId: CanvasId) => Stream.Stream<PresenceRoster>
}>()("@crit/local/PresenceRegistry") {
  static readonly layer = Layer.effect(
    PresenceRegistry,
    Effect.gen(function*() {
      const crypto = yield* Crypto.Crypto
      const state = yield* SynchronizedRef.make<RegistryState>({
        leases: new Map(),
        revision: 0
      })
      const channels = yield* SynchronizedRef.make<
        ReadonlyMap<CanvasId, PubSub.PubSub<PresenceRoster>>
      >(new Map())

      const channelFor = (canvasId: CanvasId) => SynchronizedRef.modifyEffect(
        channels,
        (current) => {
          const existing = current.get(canvasId)
          if (existing !== undefined) return Effect.succeed(pair(existing, current))
          return PubSub.sliding<PresenceRoster>(1).pipe(
            Effect.map((created) => pair(
              created,
              new Map(current).set(canvasId, created)
            ))
          )
        }
      )

      const publish = (roster: PresenceRoster) => channelFor(roster.canvasId).pipe(
        Effect.flatMap((channel) => PubSub.publish(channel, roster)),
        Effect.asVoid
      )

      const publishIfChanged = (
        roster: PresenceRoster | undefined
      ): Effect.Effect<void> => roster === undefined ? Effect.void : publish(roster)

      const sweepExpired = Effect.gen(function*() {
        const now = yield* Clock.currentTimeMillis
        const changed = yield* SynchronizedRef.modify(state, (
          current
        ): readonly [ReadonlyArray<PresenceRoster>, RegistryState] => {
          const expired = [...current.leases.values()].filter(
            (lease) => lease.expiresAtMillis <= now
          )
          if (expired.length === 0) return pair([], current)
          const nextLeases = new Map(current.leases)
          const canvasIds = new Set<CanvasId>()
          for (const lease of expired) {
            nextLeases.delete(lease.leaseId)
            canvasIds.add(lease.canvasId)
          }
          const rosters = [...canvasIds].flatMap((canvasId) => {
            const roster = changedRoster(canvasId, current.leases, nextLeases)
            return roster === undefined ? [] : [roster]
          })
          return pair(rosters, {
            leases: nextLeases,
            revision: current.revision
          })
        })
        yield* Effect.forEach(changed, publish, { discard: true })
      })

      yield* Effect.forever(
        Effect.sleep("1 second").pipe(Effect.andThen(sweepExpired))
      ).pipe(Effect.forkScoped)

      const nextLeaseId = crypto.randomUUIDv4.pipe(
        Effect.map((uuid) => Schema.decodeUnknownSync(PresenceLeaseId)(
          `lease_${uuid.replaceAll("-", "")}`
        )),
        Effect.orDie
      )

      const announce: PresenceRegistry["Service"]["announce"] = (input) =>
        sweepExpired.pipe(Effect.andThen(Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const leaseId = input.leaseId ?? (yield* nextLeaseId)
          const mutation = yield* SynchronizedRef.modifyEffect(state, (current) => {
            const existing = input.leaseId === undefined
              ? undefined
              : current.leases.get(input.leaseId)
            const key = presenceKey(input.participant)
            if (
              input.leaseId !== undefined &&
              (
                existing === undefined ||
                existing.canvasId !== input.canvasId ||
                existing.key !== key
              )
            ) {
              return Effect.fail(new PresenceLeaseNotFound({
                leaseId: input.leaseId
              }))
            }
            const revision = current.revision + 1
            const expiresAtMillis = now + presenceLeaseTtlMillis
            const nextLeases = new Map(current.leases).set(leaseId, {
              leaseId,
              canvasId: input.canvasId,
              key,
              participant: input.participant,
              expiresAtMillis,
              revision
            })
            const receipt = PresenceLeaseReceipt.make({
              leaseId,
              expiresAt: Schema.decodeUnknownSync(IsoTimestamp)(
                new Date(expiresAtMillis).toISOString()
              )
            })
            return Effect.succeed(pair({
              receipt,
              changedRoster: changedRoster(
                input.canvasId,
                current.leases,
                nextLeases
              )
            } satisfies AnnouncementMutation, {
              leases: nextLeases,
              revision
            }))
          })
          yield* publishIfChanged(mutation.changedRoster)
          return mutation.receipt
        })))

      const depart: PresenceRegistry["Service"]["depart"] = (input) =>
        sweepExpired.pipe(Effect.andThen(Effect.gen(function*() {
          const roster = yield* SynchronizedRef.modify(state, (
            current
          ): readonly [PresenceRoster | undefined, RegistryState] => {
            const existing = current.leases.get(input.leaseId)
            if (existing === undefined || existing.canvasId !== input.canvasId) {
              return pair(undefined, current)
            }
            const nextLeases = new Map(current.leases)
            nextLeases.delete(input.leaseId)
            return pair(
              changedRoster(input.canvasId, current.leases, nextLeases),
              { leases: nextLeases, revision: current.revision }
            )
          })
          yield* publishIfChanged(roster)
        })))

      const roster = (canvasId: CanvasId) => Effect.gen(function*() {
        const now = yield* Clock.currentTimeMillis
        const current = yield* SynchronizedRef.get(state)
        return rosterFromLeases(current.leases, canvasId, now)
      })

      const watch = (canvasId: CanvasId) => Stream.unwrap(
        channelFor(canvasId).pipe(
          Effect.flatMap(PubSub.subscribe),
          Effect.map((subscription) =>
            Stream.fromEffect(roster(canvasId)).pipe(
              Stream.concat(Stream.fromEffectRepeat(PubSub.take(subscription))),
              Stream.changesWith((left, right) =>
                rosterSignature(left) === rosterSignature(right)
              )
            )
          )
        )
      )

      return PresenceRegistry.of({ announce, depart, roster, watch })
    })
  )
}
