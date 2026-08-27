import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PersonSnapshot, UnspecifiedPersonEmail, Id } from "@crit/domain"
import { AgentSessionDeclaration, AgentSessionRejected } from "@crit/replica/http"
import { Context, Effect, Layer, Option, Predicate, Redacted, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { AGENT_SESSION_LIMIT, AgentSessions, type AgentSessionsService } from "../src/agent-sessions.js"

const delegatedBy = PersonSnapshot.make({
  personId: Id.person("person_agent_sessions"),
  displayName: "Ada",
  email: UnspecifiedPersonEmail.make({})
})

const tempDatabasePath = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "crit-agent-sessions-"))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
).pipe(Effect.map((directory) => join(directory, "local.sqlite")))

const withSessions = <A, E>(
  use: (sessions: AgentSessionsService) => Effect.Effect<A, E>
) => Effect.scoped(Effect.gen(function*() {
  const databasePath = yield* tempDatabasePath
  const context = yield* Layer.buildWithScope(
    AgentSessions.layer({ databasePath }),
    yield* Effect.scope
  )
  return yield* use(Context.get(context, AgentSessions))
}))

describe("AgentSessions", () => {
  it("mints a session, resolves it, and treats an unknown token as none", () =>
    Effect.runPromise(withSessions((sessions) => Effect.gen(function*() {
      const declaration = Schema.decodeUnknownSync(AgentSessionDeclaration)({
        displayName: "Codex"
      })
      const { grant, invocation } = yield* sessions.begin(declaration, delegatedBy)
      expect(Predicate.isTagged(invocation, "agent")).toBe(true)
      expect(invocation.principal.agent.displayName).toBe("Codex")
      expect(invocation.principal.delegatedBy).toEqual(delegatedBy)
      expect(invocation.principal.subject).toBe(`local-agent|${invocation.executionId}`)
      expect(invocation.executionId).toBe(grant.executionId)
      expect(grant.agent).toEqual(invocation.principal.agent)
      const resolved = yield* sessions.invocationFor(Redacted.value(grant.token))
      expect(Option.isSome(resolved)).toBe(true)
      if (Option.isSome(resolved)) expect(resolved.value).toEqual(invocation)
      const unknown = yield* sessions.invocationFor("unknown-token-with-at-least-32-characters")
      expect(unknown).toEqual(Option.none())
    }))))

  it("reuses agentId for the same displayName and mints a fresh executionId", () =>
    Effect.runPromise(withSessions((sessions) => Effect.gen(function*() {
      const declaration = Schema.decodeUnknownSync(AgentSessionDeclaration)({
        displayName: "Codex"
      })
      const first = yield* sessions.begin(declaration, delegatedBy)
      const second = yield* sessions.begin(declaration, delegatedBy)
      expect(first.grant.agent.agentId).toBe(second.grant.agent.agentId)
      expect(first.grant.executionId).not.toBe(second.grant.executionId)
      expect(Redacted.value(first.grant.token)).not.toBe(Redacted.value(second.grant.token))
      expect(first.invocation.principal.subject).not.toBe(second.invocation.principal.subject)
    }))))

  it("rejects begin past the live session cap", () =>
    Effect.runPromise(withSessions((sessions) => Effect.gen(function*() {
      const declaration = Schema.decodeUnknownSync(AgentSessionDeclaration)({
        displayName: "Codex"
      })
      for (let index = 0; index < AGENT_SESSION_LIMIT; index += 1) {
        yield* sessions.begin(declaration, delegatedBy)
      }
      const overflow = yield* sessions.begin(declaration, delegatedBy).pipe(Effect.flip)
      expect(overflow).toEqual(new AgentSessionRejected({ reason: "session-limit" }))
    }))))
})
