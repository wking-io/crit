import {
  AuthorityView,
  CanvasNotFound,
  ChangeRejected
} from "@crit/authority"
import type {
  HostedReviewClientService,
  RemoteCanvasAuthorityService
} from "@crit/client"
import {
  AccessPersonEmail,
  AuthSubject,
  CanvasChangeFailureSchema,
  EmailAddress,
  Id,
  PersonPrincipal,
  PersonSnapshot,
  decodeCanvasCommandBatch,
  decodeCanvasProjection
} from "@crit/domain"
import { ProtocolFailure, SubmitChangeReceiptSchema } from "@crit/protocol"
import {
  ReplicaChangeRejected,
  ReplicaSessionUnavailable
} from "@crit/react"
import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  hostedPersonPrincipal,
  hostedReplicaSessionPorts
} from "../src/index.js"

const canvasId = Id.canvas("canvas_hosted_review")
const email = Schema.decodeUnknownSync(EmailAddress)("grace@acme.com")
const commands = decodeCanvasCommandBatch([{
  _tag: "setFrameStatus",
  frameId: "frame_checkout",
  expectedChangedByChangeId: "change_frame_added",
  status: "changes-requested"
}])
const projection = decodeCanvasProjection({
  schemaVersion: 3,
  canvasId,
  title: "Review",
  frames: [{
    frameId: "frame_checkout",
    title: "Checkout",
    representation: { _tag: "webUrl", url: "https://example.com/checkout" },
    status: "changes-requested",
    geometry: { x: 40, y: 80, width: 320, height: 200 },
    createdByChangeId: "change_frame_added",
    updatedByChangeId: "change_hosted_status",
    titleChangedByChangeId: "change_frame_added",
    representationChangedByChangeId: "change_frame_added",
    statusChangedByChangeId: "change_hosted_status",
    geometryChangedByChangeId: "change_frame_added"
  }],
  stack: [{ _tag: "frame", frameId: "frame_checkout" }],
  stackChangedByChangeId: "change_frame_added",
  issuedIds: { frameIds: ["frame_checkout"] }
})
const reopenedView = Schema.decodeUnknownSync(AuthorityView)({
  _tag: "authorityView",
  canvasId,
  createdAt: "2026-08-27T00:00:00.000Z",
  createdBy: {
    _tag: "person",
    person: {
      _tag: "person",
      personId: "person_author",
      displayName: "Ada",
      email: { _tag: "access", address: "ada@acme.com" }
    }
  },
  cursor: "cursor_hosted_status",
  projection
})
const domainFailure = Schema.decodeUnknownSync(CanvasChangeFailureSchema)({
  _tag: "entityNotFound",
  commandIndex: 0,
  entity: "frame",
  id: "frame_missing"
})
const hostedClient: HostedReviewClientService = {
  identity: () => Effect.succeed({
    kind: "access-authenticated-person",
    schemaVersion: 1,
    address: email
  }),
  directory: () => Effect.die("unused"),
  resolveApplicationRoute: () => Effect.die("unused")
}

const principal = () => Effect.runPromise(hostedPersonPrincipal(hostedClient))

const authorityWithSubmit = (
  submit: RemoteCanvasAuthorityService["submit"],
  open: RemoteCanvasAuthorityService["open"] = () => Effect.die("unused")
): RemoteCanvasAuthorityService => ({
  open,
  submit,
  changesAfter: () => Effect.die("unused")
})

describe("hostedReplicaSessionPorts.change", () => {
  it("submits the hosted principal and reopens with no pending changes", async() => {
    const reviewer = await principal()
    const submitted: Array<{
      readonly proposal: Parameters<RemoteCanvasAuthorityService["submit"]>[0]
      readonly invocation: Parameters<RemoteCanvasAuthorityService["submit"]>[1]
    }> = []
    const open = vi.fn(() => Effect.succeed(reopenedView))
    const authority = authorityWithSubmit((proposal, invocation) => {
      submitted.push({ proposal, invocation })
      return Effect.succeed(Schema.decodeUnknownSync(SubmitChangeReceiptSchema)({
        disposition: "first-acceptance",
        change: {
          ...proposal,
          sequence: 1,
          cursor: "cursor_hosted_status",
          acceptedAt: "2026-08-27T00:00:01.000Z",
          attribution: {
            _tag: "person",
            person: reviewer.person
          }
        }
      }))
    }, open)
    const ports = hostedReplicaSessionPorts({
      authority,
      principal: reviewer
    })

    const changed = await Effect.runPromise(ports.change({ canvasId, commands }))
    const call = submitted[0]
    if (call === undefined) throw new Error("Hosted change was not submitted")

    expect(call.proposal.canvasId).toBe(canvasId)
    expect(call.proposal.commands).toEqual(commands)
    expect(call.proposal.observedCursor).toBeNull()
    expect(call.proposal.changeId).toMatch(/^change_[0-9a-f]{32}$/)
    expect(call.invocation).toEqual({
      _tag: "person",
      principal: reviewer
    })
    expect(open).toHaveBeenCalledWith(canvasId)
    expect(changed.pending).toEqual([])
    expect(changed.projection.frames[0]?.status).toBe("changes-requested")
  })

  it("maps changeRejected to ReplicaChangeRejected", async() => {
    const reviewer = await principal()
    const authority = authorityWithSubmit((proposal) =>
      Effect.fail(ChangeRejected.make({
        canvasId,
        changeId: proposal.changeId,
        failure: domainFailure
      }))
    )
    const ports = hostedReplicaSessionPorts({
      authority,
      principal: reviewer
    })

    const failure = await Effect.runPromise(
      Effect.flip(ports.change({ canvasId, commands }))
    )

    expect(failure).toEqual(new ReplicaChangeRejected({
      canvasId,
      failure: domainFailure
    }))
  })

  it("maps a missing Canvas to ReplicaSessionUnavailable", async() => {
    const reviewer = await principal()
    const authority = authorityWithSubmit(() =>
      Effect.fail(CanvasNotFound.make({ canvasId }))
    )
    const ports = hostedReplicaSessionPorts({
      authority,
      principal: reviewer
    })

    const failure = await Effect.runPromise(
      Effect.flip(ports.change({ canvasId, commands }))
    )

    expect(failure).toEqual(new ReplicaSessionUnavailable({
      canvasId,
      reason: "The canvas does not exist."
    }))
  })

  it("maps a transport failure to ReplicaSessionUnavailable", async() => {
    const reviewer = await principal()
    const authority = authorityWithSubmit(() =>
      Effect.die(new Error("network unavailable"))
    )
    const ports = hostedReplicaSessionPorts({
      authority,
      principal: reviewer
    })

    const failure = await Effect.runPromise(
      Effect.flip(ports.change({ canvasId, commands }))
    )

    expect(failure).toEqual(new ReplicaSessionUnavailable({
      canvasId,
      reason: "The hosted service is unreachable."
    }))
  })
})

describe("hostedReplicaSessionPorts.open", () => {
  const protocolCanvasId = Id.canvas("canvas_review")
  const upgradePrincipal = PersonPrincipal.make({
    subject: Schema.decodeUnknownSync(AuthSubject)("access|ada@acme.com"),
    person: PersonSnapshot.make({
      personId: Id.person("person_ada"),
      displayName: "Ada",
      email: AccessPersonEmail.make({
        address: Schema.decodeUnknownSync(EmailAddress)("ada@acme.com")
      })
    })
  })
  const upgrade = ProtocolFailure.unsupportedVersion({
    location: "message",
    requestedVersion: 2,
    supportedVersion: 1,
    message:
      "Schema version 2 is unsupported. This installation speaks version 1. Upgrade Crit so the client and installation match."
  })

  it("maps a protocol failure to the upgrade copy", async() => {
    const ports = hostedReplicaSessionPorts({
      authority: {
        open: () => Effect.fail(upgrade),
        submit: () => Effect.die("unused"),
        changesAfter: () => Effect.die("unused")
      },
      principal: upgradePrincipal
    })

    const failure = await Effect.runPromise(Effect.flip(ports.open(protocolCanvasId)))

    expect(failure).toEqual(new ReplicaSessionUnavailable({
      canvasId: protocolCanvasId,
      reason: upgrade.message
    }))
  })
})
