import {
  AgentInvocation,
  AuthorityModel
} from "@crit/authority"
import {
  AgentSnapshot,
  Id,
  PersonSnapshot
} from "@crit/domain"
import {
  ActiveAgentExecutionClaim,
  ConnectedPersonClaim,
  PresenceClaimMismatch,
  PresenceLeaseId,
  PresenceLeaseNotFound
} from "@crit/replica/http"
import {
  Context,
  Crypto,
  Effect,
  Fiber,
  Layer,
  Schema,
  Stream
} from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"

import {
  PresenceRegistry,
  delegatingPerson,
  presenceParticipantFromClaim
} from "../src/presence-registry.js"

const canvasId = Id.canvas("canvas_presence_registry")
const person = PersonSnapshot.make({
  personId: Id.person("person_registry"),
  displayName: "Registry Person"
})
const delegatedBy = PersonSnapshot.make({
  personId: Id.person("person_delegating"),
  displayName: "Delegating Person"
})
const claimedAgent = AgentSnapshot.make({
  agentId: Id.agent("agent_claimed"),
  displayName: "Claimed Agent"
})
const verifiedAgent = AgentSnapshot.make({
  agentId: Id.agent("agent_verified"),
  displayName: "Verified Agent"
})
const personInvocation = AuthorityModel.personInvocation({
  principal: {
    _tag: "person",
    subject: "local|presence-registry",
    person
  }
})
const agentInvocation = AgentInvocation.make({
  principal: {
    _tag: "agent",
    subject: "agent|presence-registry",
    agent: verifiedAgent,
    delegatedBy
  },
  executionId: Id.execution("execution_verified")
})

const cryptoLayer = () => {
  let sequence = 0
  return Layer.succeed(Crypto.Crypto, Crypto.make({
    randomBytes: (size) => {
      sequence += 1
      const bytes = new Uint8Array(size)
      bytes[bytes.length - 1] = sequence
      return bytes
    },
    digest: (_algorithm, data) => Effect.succeed(data)
  }))
}

const runRegistry = <A, E>(
  use: (registry: PresenceRegistry["Service"]) => Effect.Effect<A, E, never>
): Promise<A> => Effect.runPromise(
  Effect.scoped(Effect.gen(function*() {
    const scope = yield* Effect.scope
    const context = yield* Layer.buildWithScope(
      PresenceRegistry.layer.pipe(Layer.provide(cryptoLayer())),
      scope
    )
    return yield* use(Context.get(context, PresenceRegistry))
  })).pipe(Effect.provide(TestClock.layer()))
)

describe("presenceParticipantFromClaim", () => {
  it("stamps verified people and Person-delegated Agent runs", async() => {
    const connected = await Effect.runPromise(presenceParticipantFromClaim(
      ConnectedPersonClaim.make({}),
      personInvocation
    ))
    expect(connected).toEqual({
      _tag: "connected-person",
      person
    })

    const executionId = Id.execution("execution_claimed")
    const active = await Effect.runPromise(presenceParticipantFromClaim(
      ActiveAgentExecutionClaim.make({
        agent: claimedAgent,
        executionId
      }),
      personInvocation
    ))
    expect(active).toEqual({
      _tag: "active-agent-execution",
      agent: claimedAgent,
      delegatedBy: person,
      executionId
    })
  })

  it("uses verified Agent identity and rejects Person claims from Agent invocations", async() => {
    const active = await Effect.runPromise(presenceParticipantFromClaim(
      ActiveAgentExecutionClaim.make({
        agent: claimedAgent,
        executionId: Id.execution("execution_claimed")
      }),
      agentInvocation
    ))
    expect(active).toEqual({
      _tag: "active-agent-execution",
      agent: verifiedAgent,
      delegatedBy,
      executionId: Id.execution("execution_verified")
    })
    expect(delegatingPerson(agentInvocation)).toEqual(delegatedBy)

    const mismatch = await Effect.runPromise(Effect.flip(
      presenceParticipantFromClaim(
        ConnectedPersonClaim.make({}),
        agentInvocation
      )
    ))
    expect(mismatch).toBeInstanceOf(PresenceClaimMismatch)
  })
})

describe("PresenceRegistry", () => {
  it("deduplicates two Person leases and keeps heartbeats silent", () =>
    runRegistry((registry) => Effect.gen(function*() {
      const participant = yield* presenceParticipantFromClaim(
        ConnectedPersonClaim.make({}),
        personInvocation
      )
      const pull = yield* Stream.toPull(registry.watch(canvasId))
      expect((yield* pull)[0]?.people).toEqual([])

      const first = yield* registry.announce({ canvasId, participant })
      expect((yield* pull)[0]?.people).toEqual([participant])

      const second = yield* registry.announce({ canvasId, participant })
      expect((yield* registry.roster(canvasId)).people).toEqual([participant])

      yield* registry.depart({ canvasId, leaseId: first.leaseId })
      expect((yield* registry.roster(canvasId)).people).toEqual([participant])

      const pendingChange = yield* pull.pipe(Effect.forkChild)
      yield* registry.announce({
        canvasId,
        participant,
        leaseId: second.leaseId
      })
      expect(pendingChange.pollUnsafe()).toBeUndefined()

      yield* registry.depart({ canvasId, leaseId: second.leaseId })
      expect((yield* Fiber.join(pendingChange))[0]?.people).toEqual([])
    })))

  it("expires leases and emits the empty roster", () =>
    runRegistry((registry) => Effect.gen(function*() {
      const participant = yield* presenceParticipantFromClaim(
        ActiveAgentExecutionClaim.make({
          agent: claimedAgent,
          executionId: Id.execution("execution_expiring")
        }),
        personInvocation
      )
      const pull = yield* Stream.toPull(registry.watch(canvasId))
      yield* pull
      yield* registry.announce({ canvasId, participant })
      expect((yield* pull)[0]?.agentRuns).toHaveLength(1)

      yield* TestClock.adjust("31 seconds")
      expect((yield* pull)[0]?.agentRuns).toEqual([])
      expect((yield* registry.roster(canvasId)).agentRuns).toEqual([])
    })))

  it("rejects an unknown lease refresh", () =>
    runRegistry((registry) => Effect.gen(function*() {
      const participant = yield* presenceParticipantFromClaim(
        ConnectedPersonClaim.make({}),
        personInvocation
      )
      const leaseId = Schema.decodeUnknownSync(PresenceLeaseId)(
        "lease_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      )
      const failure = yield* registry.announce({
        canvasId,
        participant,
        leaseId
      }).pipe(Effect.flip)
      expect(failure).toEqual(new PresenceLeaseNotFound({ leaseId }))
    })))
})
