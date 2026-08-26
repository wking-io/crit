import { AgentInvocation } from "@crit/authority"
import {
  AgentId,
  AgentPrincipal,
  AgentSnapshot,
  AuthSubject,
  Id,
  type PersonSnapshot
} from "@crit/domain"
import {
  AgentSessionGrant,
  AgentSessionRejected,
  AgentSessionToken,
  type AgentSessionDeclaration
} from "@crit/replica/http"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { NodeCrypto } from "@effect/platform-node"
import { Context, Crypto, Effect, Encoding, Layer, Option, Ref, Schema } from "effect"

import { localDatabaseLayer, type LocalDatabaseOpenFailure } from "./database.js"

export const AGENT_SESSION_LIMIT = 256

const AgentIdentityRow = Schema.Struct({
  agent_id: AgentId
})

export interface AgentSessionsService {
  readonly begin: (
    declaration: AgentSessionDeclaration,
    delegatedBy: PersonSnapshot
  ) => Effect.Effect<
    { readonly grant: AgentSessionGrant; readonly invocation: AgentInvocation },
    AgentSessionRejected
  >
  readonly invocationFor: (
    credential: string
  ) => Effect.Effect<Option.Option<AgentInvocation>>
}

export class AgentSessions extends Context.Service<AgentSessions, AgentSessionsService>()(
  "@crit/local/AgentSessions"
) {
  static readonly layer: (options: {
    readonly databasePath: string
  }) => Layer.Layer<AgentSessions, LocalDatabaseOpenFailure> = (options) => Layer.effect(
    AgentSessions,
    Effect.gen(function*() {
      const sql = yield* SqliteClient.SqliteClient
      const crypto = yield* Crypto.Crypto
      const live = yield* Ref.make(new Map<string, AgentInvocation>())
      const digestOf = (value: string) => crypto.digest(
        "SHA-256",
        new TextEncoder().encode(value)
      ).pipe(
        Effect.map((bytes) => Encoding.encodeHex(bytes)),
        Effect.orDie
      )
      const nextSuffix = crypto.randomUUIDv4.pipe(
        Effect.map((uuid) => uuid.replaceAll("-", "")),
        Effect.orDie
      )
      const resolveAgentId = (displayName: string) => Effect.gen(function*() {
        const existing = yield* sql<typeof AgentIdentityRow.Encoded>`
          SELECT agent_id FROM agent_identities WHERE display_name = ${displayName}`
        const row = existing[0]
        if (row !== undefined) {
          return Schema.decodeUnknownSync(AgentIdentityRow)(row).agent_id
        }
        const agentId = Id.agent(`agent_${yield* nextSuffix}`)
        yield* sql`INSERT INTO agent_identities (display_name, agent_id)
          VALUES (${displayName}, ${agentId})`
        return agentId
      }).pipe(Effect.orDie)
      return AgentSessions.of({
        begin: (declaration, delegatedBy) => Effect.gen(function*() {
          const current = yield* Ref.get(live)
          if (current.size >= AGENT_SESSION_LIMIT) {
            return yield* new AgentSessionRejected({ reason: "session-limit" })
          }
          const agentId = yield* resolveAgentId(declaration.displayName)
          const executionId = Id.execution(`execution_${yield* nextSuffix}`)
          const rawToken = Encoding.encodeBase64Url(yield* crypto.randomBytes(64).pipe(Effect.orDie))
          const token = Schema.decodeUnknownSync(AgentSessionToken)(rawToken)
          const tokenDigest = yield* digestOf(rawToken)
          const agent = AgentSnapshot.make({
            agentId,
            displayName: declaration.displayName
          })
          const principal = AgentPrincipal.make({
            subject: Schema.decodeUnknownSync(AuthSubject)(`local-agent|${executionId}`),
            agent,
            delegatedBy
          })
          const invocation = declaration.reportedRuntime === undefined
            ? AgentInvocation.make({ principal, executionId })
            : AgentInvocation.make({
              principal,
              executionId,
              reportedRuntime: declaration.reportedRuntime
            })
          const stored = yield* Ref.modify(live, (map) => {
            if (map.size >= AGENT_SESSION_LIMIT) return [false, map] as const
            const next = new Map(map)
            next.set(tokenDigest, invocation)
            return [true, next] as const
          })
          if (!stored) return yield* new AgentSessionRejected({ reason: "session-limit" })
          return {
            grant: AgentSessionGrant.make({ token, agent, executionId }),
            invocation
          }
        }),
        invocationFor: (credential) => Effect.gen(function*() {
          const digest = yield* digestOf(credential)
          const found = (yield* Ref.get(live)).get(digest)
          return found === undefined ? Option.none() : Option.some(found)
        })
      })
    })
  ).pipe(
    Layer.provide(localDatabaseLayer({ path: options.databasePath })),
    Layer.provide(NodeCrypto.layer)
  )
}
