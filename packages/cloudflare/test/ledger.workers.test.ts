import {
  AccessPersonEmail,
  CanvasTitle,
  EmailAddress,
  Id,
  PersonSnapshot,
  Sha256Digest,
  decodeCanvasCommandBatch
} from "@crit/domain"
import {
  ChangeProtocol,
  decodeSubmitCanvasChangeWire,
  encodeShareCanvasWire,
  encodeSubmitCanvasChangeWire,
  remoteCanvasChangesPath,
  remoteCanvasPath
} from "@crit/protocol"
import { AuthorityView, PersonInvocation } from "@crit/authority"
import { SELF } from "cloudflare:test"
import { Predicate, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

const accessEmail = "ada@acme.com"

const person = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: `access|${accessEmail}`,
    person: {
      _tag: "person",
      personId: "person_share_worker",
      displayName: "Ada Lovelace",
      email: { _tag: "access", address: accessEmail }
    }
  }
})

const shareBody = (canvasId: string) => {
  const email = AccessPersonEmail.make({
    address: Schema.decodeUnknownSync(EmailAddress)(accessEmail)
  })
  const snapshot = PersonSnapshot.make({
    personId: Id.person("person_share_worker"),
    displayName: "Ada Lovelace",
    email
  })
  return JSON.stringify(encodeShareCanvasWire({
    kind: "share-canvas",
    schemaVersion: 2,
    canvasId: Id.canvas(canvasId),
    title: Schema.decodeUnknownSync(CanvasTitle)("Checkout"),
    shareId: Id.share(`share_${canvasId}`),
    importId: Id.imported(`import_${canvasId}`),
    projectionDigest: Schema.decodeUnknownSync(Sha256Digest)(
      `sha256:${"a".repeat(64)}`
    ),
    person: {
      ...snapshot,
      email
    }
  }))
}

const accessHeaders = {
  "content-type": "application/json",
  "Cf-Access-Authenticated-User-Email": accessEmail
}

const share = (canvasId: string) => SELF.fetch("https://crit.example/canvas", {
  method: "POST",
  headers: accessHeaders,
  body: shareBody(canvasId)
})

const rename = decodeCanvasCommandBatch([{
  _tag: "renameCanvas",
  expectedTitle: "Checkout",
  title: "Review"
}])

const addFrame = decodeCanvasCommandBatch([{
  _tag: "addFrame",
  frameId: "frame_checkout",
  title: "Checkout",
  representation: {
    _tag: "webUrl",
    url: "https://example.com/checkout"
  },
  status: "ready-for-review",
  geometry: { x: 0, y: 0, width: 320, height: 200 }
}])

const teammateInvocation = async(email: string): Promise<PersonInvocation> => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email))
  )
  const digest = Array.from(
    bytes,
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("")
  return Schema.decodeUnknownSync(PersonInvocation)({
    _tag: "person",
    principal: {
      _tag: "person",
      subject: `access|${email}`,
      person: {
        _tag: "person",
        personId: `person_${digest.slice(0, 32)}`,
        displayName: email.slice(0, email.indexOf("@")),
        email: { _tag: "access", address: email }
      }
    }
  })
}

describe("Worker canvas ledger routes", () => {
  it("pushes by change ID and pulls after the cursor", async() => {
    const canvasId = Id.canvas("canvas_worker_ledger")
    const shared = await share(canvasId)
    const opened = await SELF.fetch(`https://crit.example${remoteCanvasPath(canvasId)}`, {
      headers: accessHeaders
    })
    const view = Schema.decodeUnknownSync(AuthorityView)(await opened.json())
    const proposal = {
      changeId: Id.change("change_worker_rename"),
      canvasId,
      observedCursor: view.cursor,
      commands: rename
    }
    const first = await SELF.fetch(`https://crit.example${remoteCanvasChangesPath(canvasId)}`, {
      method: "POST",
      headers: accessHeaders,
      body: JSON.stringify(encodeSubmitCanvasChangeWire({
        invocation: person,
        proposal
      }))
    })
    const retry = await SELF.fetch(`https://crit.example${remoteCanvasChangesPath(canvasId)}`, {
      method: "POST",
      headers: accessHeaders,
      body: JSON.stringify(encodeSubmitCanvasChangeWire({
        invocation: person,
        proposal
      }))
    })
    const pulled = await SELF.fetch(
      `https://crit.example${remoteCanvasChangesPath(canvasId)}?after=${view.cursor}&limit=100`,
      { headers: accessHeaders }
    )
    const firstReceipt = ChangeProtocol.receipt.decode(await first.json())
    const retryReceipt = ChangeProtocol.receipt.decode(await retry.json())
    const page = ChangeProtocol.page.decode(await pulled.json())

    expect(shared.status).toBe(200)
    expect(opened.status).toBe(200)
    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(Result.isSuccess(firstReceipt) && firstReceipt.success.disposition).toBe("first-acceptance")
    expect(Result.isSuccess(retryReceipt) && retryReceipt.success.disposition).toBe("identical-retry")
    expect(Result.isSuccess(page) && page.success.changes.map((change) => change.changeId)).toEqual([
      "change_worker_rename"
    ])

    if (Result.isFailure(firstReceipt)) return
    const tail = await SELF.fetch(
      `https://crit.example${remoteCanvasChangesPath(canvasId)}?after=${firstReceipt.success.change.cursor}&limit=100`,
      { headers: accessHeaders }
    )
    const empty = ChangeProtocol.page.decode(await tail.json())
    expect(tail.status).toBe(200)
    expect(Result.isSuccess(empty) && empty.success.changes).toEqual([])
  })

  it("lands a teammate setFrameStatus under the teammate Access identity", async() => {
    const canvasId = Id.canvas("canvas_worker_teammate_status")
    const addedChangeId = Id.change("change_worker_add_frame")
    const teammateChangeId = Id.change("change_worker_teammate_status")
    const teammateEmail = "grace@acme.com"
    const teammateHeaders = {
      "content-type": "application/json",
      "Cf-Access-Authenticated-User-Email": teammateEmail
    }
    const shared = await share(canvasId)
    const authorOpened = await SELF.fetch(
      `https://crit.example${remoteCanvasPath(canvasId)}`,
      { headers: accessHeaders }
    )
    const authorView = Schema.decodeUnknownSync(AuthorityView)(await authorOpened.json())
    const added = await SELF.fetch(
      `https://crit.example${remoteCanvasChangesPath(canvasId)}`,
      {
        method: "POST",
        headers: accessHeaders,
        body: JSON.stringify(encodeSubmitCanvasChangeWire({
          invocation: person,
          proposal: {
            changeId: addedChangeId,
            canvasId,
            observedCursor: authorView.cursor,
            commands: addFrame
          }
        }))
      }
    )
    const teammateOpened = await SELF.fetch(
      `https://crit.example${remoteCanvasPath(canvasId)}`,
      { headers: teammateHeaders }
    )
    const teammateView = Schema.decodeUnknownSync(AuthorityView)(
      await teammateOpened.json()
    )
    const frame = teammateView.projection.frames.find(
      ({ frameId }) => frameId === "frame_checkout"
    )
    if (frame === undefined) throw new Error("Shared Frame missing")
    const commands = decodeCanvasCommandBatch([{
      _tag: "setFrameStatus",
      frameId: frame.frameId,
      expectedChangedByChangeId: frame.statusChangedByChangeId,
      status: "changes-requested"
    }])
    const changed = await SELF.fetch(
      `https://crit.example${remoteCanvasChangesPath(canvasId)}`,
      {
        method: "POST",
        headers: teammateHeaders,
        body: JSON.stringify(encodeSubmitCanvasChangeWire({
          invocation: await teammateInvocation(teammateEmail),
          proposal: {
            changeId: teammateChangeId,
            canvasId,
            observedCursor: teammateView.cursor,
            commands
          }
        }))
      }
    )
    const receipt = ChangeProtocol.receipt.decode(await changed.json())
    const reopened = await SELF.fetch(
      `https://crit.example${remoteCanvasPath(canvasId)}`,
      { headers: teammateHeaders }
    )
    const reopenedView = Schema.decodeUnknownSync(AuthorityView)(await reopened.json())
    const changedFrame = reopenedView.projection.frames.find(
      ({ frameId }) => frameId === frame.frameId
    )

    expect(shared.status).toBe(200)
    expect(added.status).toBe(200)
    expect(teammateOpened.status).toBe(200)
    expect(changed.status).toBe(200)
    expect(Result.isSuccess(receipt) && receipt.success.disposition).toBe("first-acceptance")
    expect(changedFrame?.status).toBe("changes-requested")
    expect(changedFrame?.statusChangedByChangeId).toBe(teammateChangeId)
  })

  it("allows anonymous ledger reads", async() => {
    const canvasId = Id.canvas("canvas_worker_ledger_auth")
    await share(canvasId)
    const response = await SELF.fetch(`https://crit.example${remoteCanvasChangesPath(canvasId)}`)

    expect(response.status).toBe(200)
  })

  it("rejects a Person Access email that does not match the request", async() => {
    const canvasId = Id.canvas("canvas_worker_ledger_mismatch")
    await share(canvasId)
    const opened = await SELF.fetch(`https://crit.example${remoteCanvasPath(canvasId)}`, {
      headers: accessHeaders
    })
    const view = Schema.decodeUnknownSync(AuthorityView)(await opened.json())
    const other = Schema.decodeUnknownSync(PersonInvocation)({
      _tag: "person",
      principal: {
        _tag: "person",
        subject: "access|grace@acme.com",
        person: {
          _tag: "person",
          personId: "person_share_worker",
          displayName: "Ada Lovelace",
          email: { _tag: "access", address: "grace@acme.com" }
        }
      }
    })
    const response = await SELF.fetch(`https://crit.example${remoteCanvasChangesPath(canvasId)}`, {
      method: "POST",
      headers: accessHeaders,
      body: JSON.stringify(encodeSubmitCanvasChangeWire({
        invocation: other,
        proposal: {
          changeId: Id.change("change_worker_mismatch"),
          canvasId,
          observedCursor: view.cursor,
          commands: rename
        }
      }))
    })

    expect(response.status).toBe(401)
    expect(await response.text()).toBe("")
  })

  it("reports a missing Canvas and an unknown cursor", async() => {
    const missing = await SELF.fetch(
      `https://crit.example${remoteCanvasPath(Id.canvas("canvas_worker_ledger_missing"))}`,
      { headers: accessHeaders }
    )
    const canvasId = Id.canvas("canvas_worker_ledger_cursor")
    await share(canvasId)
    const badCursor = await SELF.fetch(
      `https://crit.example${remoteCanvasChangesPath(canvasId)}?after=cursor_unknown&limit=10`,
      { headers: accessHeaders }
    )

    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ _tag: "canvasNotFound" })
    expect(badCursor.status).toBe(404)
    expect(await badCursor.json()).toMatchObject({ _tag: "cursorNotFound" })
  })

  it("rejects a trusted field on the proposed change", async() => {
    const canvasId = Id.canvas("canvas_worker_ledger_trusted")
    await share(canvasId)
    const opened = await SELF.fetch(`https://crit.example${remoteCanvasPath(canvasId)}`, {
      headers: accessHeaders
    })
    const view = Schema.decodeUnknownSync(AuthorityView)(await opened.json())
    const encoded = encodeSubmitCanvasChangeWire({
      invocation: person,
      proposal: {
        changeId: Id.change("change_worker_trusted"),
        canvasId,
        observedCursor: view.cursor,
        commands: rename
      }
    })
    const forged = {
      ...encoded,
      change: {
        ...encoded.change,
        commands: encoded.change.commands.map((command) => ({
          ...command,
          sequence: 1
        }))
      }
    }
    const response = await SELF.fetch(`https://crit.example${remoteCanvasChangesPath(canvasId)}`, {
      method: "POST",
      headers: accessHeaders,
      body: JSON.stringify(forged)
    })
    const failure = ChangeProtocol.failure.decode(await response.json())

    expect(response.status).toBe(400)
    expect(Result.isFailure(decodeSubmitCanvasChangeWire(forged))).toBe(true)
    expect(Result.isSuccess(failure) && Predicate.isTagged(failure.success, "trustedField")).toBe(true)
  })

  it("rejects an unsupported submit envelope version with an upgrade error", async() => {
    const canvasId = Id.canvas("canvas_worker_ledger_version")
    await share(canvasId)
    const encoded = encodeSubmitCanvasChangeWire({
      invocation: person,
      proposal: {
        changeId: Id.change("change_worker_version"),
        canvasId,
        observedCursor: null,
        commands: rename
      }
    })
    const response = await SELF.fetch(`https://crit.example${remoteCanvasChangesPath(canvasId)}`, {
      method: "POST",
      headers: accessHeaders,
      body: JSON.stringify({ ...encoded, schemaVersion: 2 })
    })
    const failure = ChangeProtocol.failure.decode(await response.json())

    expect(response.status).toBe(426)
    expect(Result.isSuccess(failure) && failure.success).toEqual({
      _tag: "unsupportedVersion",
      location: "message",
      requestedVersion: 2,
      supportedVersion: 1,
      message: "Schema version 2 is unsupported. This installation speaks version 1. Upgrade Crit so the client and installation match."
    })
  })
})
