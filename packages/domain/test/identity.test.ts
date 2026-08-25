import { describe, expect, it } from "vitest"
import { Schema } from "effect"

import {
  AcceptedAttribution,
  ActorSnapshot,
  actorFromAttribution,
  actorFromPrincipal,
  Id,
  Principal,
  ReportedRuntime,
  decodeAcceptedAttribution,
  decodeActorSnapshot,
  decodePrincipal,
  decodeReportedRuntime
} from "../src/index.js"

const unspecifiedEmail = { _tag: "unspecified" as const }
const person = {
  _tag: "person",
  personId: Id.person("person_will"),
  displayName: "Will King",
  email: unspecifiedEmail
}

const agent = {
  _tag: "agent",
  agentId: Id.agent("agent_codex"),
  displayName: "Codex"
}

const reportedRuntime = {
  _tag: "reported-runtime",
  source: "client-reported",
  harness: { name: "Codex Desktop", version: "1.42.0" },
  model: { provider: "openai", name: "gpt-5.6" },
  sessionId: "thread_01K"
}

describe("ActorSnapshot", () => {
  it.each([person, agent])("round-trips every variant", (input) => {
    const decoded = decodeActorSnapshot(input)
    expect(Schema.encodeSync(ActorSnapshot)(decoded)).toEqual(input)
  })

  it("rejects malformed and extra fields", () => {
    expect(() => decodeActorSnapshot({ ...person, agentId: "agent_codex" })).toThrow()
    expect(() => decodeActorSnapshot({ _tag: "robot", displayName: "Codex" })).toThrow()
    expect(() => decodeActorSnapshot({ ...person, displayName: "  " })).toThrow()
  })

  it("requires an email state and rejects a raw or malformed address", () => {
    const provisional = {
      ...person,
      email: { _tag: "provisional" as const, address: "will@example.com" }
    }
    expect(decodeActorSnapshot(provisional)).toEqual(provisional)
    expect(decodeActorSnapshot(person)).toEqual(person)
    expect(() => decodeActorSnapshot({
      _tag: "person",
      personId: person.personId,
      displayName: person.displayName
    })).toThrow()
    expect(() => decodeActorSnapshot({ ...person, email: "will@example.com" })).toThrow()
    expect(() => decodeActorSnapshot({
      ...person,
      email: { _tag: "provisional", address: "" }
    })).toThrow()
    expect(() => decodeActorSnapshot({
      ...person,
      email: { _tag: "provisional", address: "not-an-email" }
    })).toThrow()
    expect(() => decodeActorSnapshot({
      ...person,
      email: { _tag: "provisional", address: "a@b" }
    })).toThrow()
  })

  it("rejects email on an agent as an excess property", () => {
    expect(() => decodeActorSnapshot({ ...agent, email: "will@example.com" })).toThrow()
  })

  it("completes a stored Person inside a principal when email is missing", () => {
    expect(decodePrincipal({
      _tag: "person",
      subject: "oidc|will",
      person: {
        _tag: "person",
        personId: person.personId,
        displayName: person.displayName
      }
    })).toEqual({
      _tag: "person",
      subject: "oidc|will",
      person
    })
  })
})

describe("Principal", () => {
  const personPrincipal = {
    _tag: "person",
    subject: "oidc|will",
    person
  }
  const agentPrincipal = {
    _tag: "agent",
    subject: "local-agent|codex",
    agent,
    delegatedBy: person
  }

  it.each([personPrincipal, agentPrincipal])("round-trips every variant", (input) => {
    const decoded = decodePrincipal(input)
    expect(Schema.encodeSync(Principal)(decoded)).toEqual(input)
  })

  it("requires the fields belonging to each variant", () => {
    expect(() => decodePrincipal({ _tag: "person", subject: "oidc|will", agent })).toThrow()
    expect(() => decodePrincipal({ _tag: "agent", subject: "local-agent|codex", agent })).toThrow()
  })

  it("rejects malformed and extra fields", () => {
    expect(() => decodePrincipal({ ...personPrincipal, executionId: "execution_01K" })).toThrow()
    expect(() => decodePrincipal({ ...agentPrincipal, grantId: "grant_storefront" })).toThrow()
  })
})

describe("ReportedRuntime", () => {
  it("round-trips visibly client-reported metadata", () => {
    const decoded = decodeReportedRuntime(reportedRuntime)
    expect(Schema.encodeSync(ReportedRuntime)(decoded)).toEqual(reportedRuntime)
  })

  it("rejects missing harness, blank names, and extra fields", () => {
    expect(() => decodeReportedRuntime({
      _tag: "reported-runtime",
      source: "client-reported"
    })).toThrow()
    expect(() => decodeReportedRuntime({
      ...reportedRuntime,
      harness: { name: "" }
    })).toThrow()
    expect(() => decodeReportedRuntime({ ...reportedRuntime, token: "secret" })).toThrow()
  })
})

describe("AcceptedAttribution", () => {
  const personAttribution = {
    _tag: "person",
    person
  }
  const agentAttribution = {
    _tag: "agent",
    agent,
    delegatedBy: person,
    executionId: "execution_01K",
    reportedRuntime
  }

  it.each([personAttribution, agentAttribution])("round-trips every variant", (input) => {
    const decoded = decodeAcceptedAttribution(input)
    expect(Schema.encodeSync(AcceptedAttribution)(decoded)).toEqual(input)
  })

  it("cannot contain an authentication subject", () => {
    expect(() => decodeAcceptedAttribution({
      ...personAttribution,
      subject: "oidc|will"
    })).toThrow()
    expect(() => decodeAcceptedAttribution({
      ...agentAttribution,
      subject: "local-agent|codex"
    })).toThrow()
  })

  it("keeps server-trusted execution fields outside reported runtime", () => {
    expect(() => decodeAcceptedAttribution({
      ...agentAttribution,
      reportedRuntime: {
        ...reportedRuntime,
        executionId: "execution_forged"
      }
    })).toThrow()
  })

  it("rejects malformed and extra fields", () => {
    expect(() => decodeAcceptedAttribution({ ...agentAttribution, grantId: "grant_storefront" })).toThrow()
    expect(() => decodeAcceptedAttribution({ ...personAttribution, delegatedBy: person })).toThrow()
  })

  it("projects only the Actor from trusted attribution and principals", () => {
    expect(actorFromAttribution(decodeAcceptedAttribution(personAttribution))).toEqual(person)
    expect(actorFromAttribution(decodeAcceptedAttribution(agentAttribution))).toEqual(agent)
    expect(actorFromPrincipal(decodePrincipal({
      _tag: "person",
      subject: "oidc|will",
      person
    }))).toEqual(person)
    expect(actorFromPrincipal(decodePrincipal({
      _tag: "agent",
      subject: "local-agent|codex",
      agent,
      delegatedBy: person
    }))).toEqual(agent)
  })
})
