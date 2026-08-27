import {
  AccessPersonEmail,
  CanvasTitle,
  EmailAddress,
  Id,
  PersonSnapshot,
  Sha256Digest,
  type PresenceRoster
} from "@crit/domain"
import {
  encodeShareCanvasWire,
  PresenceChangedSchema,
  remoteCanvasPresencePath
} from "@crit/protocol"
import { SELF } from "cloudflare:test"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const digest = (hex: string) => Schema.decodeUnknownSync(Sha256Digest)(
  `sha256:${hex.repeat(64)}`
)

const share = (canvasId: string) => {
  const email = AccessPersonEmail.make({
    address: Schema.decodeUnknownSync(EmailAddress)("ada@acme.com")
  })
  const person = PersonSnapshot.make({
    personId: Id.person("person_share_worker"),
    displayName: "Ada Lovelace",
    email
  })
  return SELF.fetch("https://crit.example/canvas", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Cf-Access-Authenticated-User-Email": "ada@acme.com"
    },
    body: JSON.stringify(encodeShareCanvasWire({
      kind: "share-canvas",
      schemaVersion: 2,
      canvasId: Id.canvas(canvasId),
      title: Schema.decodeUnknownSync(CanvasTitle)("Checkout"),
      shareId: Id.share(`share_${canvasId}`),
      importId: Id.imported(`import_${canvasId}`),
      projectionDigest: digest("a"),
      person: {
        ...person,
        email
      }
    }))
  })
}

const presenceUrl = (canvasId: string) =>
  `https://crit.example${remoteCanvasPresencePath(Id.canvas(canvasId))}`

const connect = async (canvasId: string, email: string) => {
  const response = await SELF.fetch(presenceUrl(canvasId), {
    headers: {
      Upgrade: "websocket",
      "Cf-Access-Authenticated-User-Email": email
    }
  })
  const socket = response.webSocket
  if (socket === null || socket === undefined) {
    return { response, socket: undefined, roster: undefined }
  }
  const roster = nextRoster(socket)
  socket.accept()
  socket.send("attend")
  return { response, socket, roster }
}

const nextRoster = (socket: WebSocket): Promise<PresenceRoster> =>
  new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.removeEventListener("message", onMessage)
    reject(new Error("timed out waiting for presence"))
  }, 3_000)
  const onMessage = (event: MessageEvent) => {
    clearTimeout(timer)
    socket.removeEventListener("message", onMessage)
    try {
      const decoded = Schema.decodeUnknownSync(PresenceChangedSchema)(
        JSON.parse(String(event.data))
      )
      resolve(decoded.roster)
    } catch (cause) {
      reject(cause)
    }
  }
  socket.addEventListener("message", onMessage)
})

describe("Worker shared Canvas occupancy", () => {
  it("lists Access-authenticated people and drops them when they leave", async() => {
    const canvasId = "canvas_presence_shared"
    await share(canvasId)
    const ada = await connect(canvasId, "ada@acme.com")
    expect(ada.response.status).toBe(101)
    if (ada.socket === undefined || ada.roster === undefined) {
      throw new Error("Ada websocket missing")
    }
    const adaFirst = await ada.roster
    expect(adaFirst).toMatchObject({
      canvasId,
      people: [{
        person: {
          displayName: "ada",
          email: { _tag: "access", address: "ada@acme.com" }
        }
      }]
    })

    const will = await connect(canvasId, "will@acme.com")
    expect(will.response.status).toBe(101)
    if (will.socket === undefined || will.roster === undefined) {
      throw new Error("Will websocket missing")
    }
    const adaBoth = await nextRoster(ada.socket)
    const willBoth = await will.roster
    expect(adaBoth).toEqual(willBoth)
    expect(adaBoth).toMatchObject({
      people: [
        { person: { displayName: "ada" } },
        { person: { displayName: "will" } }
      ]
    })

    const willAfterAda = nextRoster(will.socket)
    ada.socket.close()
    expect(await willAfterAda).toMatchObject({
      people: [{ person: { displayName: "will" } }]
    })
  })

  it("collapses one Person across seats", async() => {
    const canvasId = "canvas_presence_seats"
    await share(canvasId)
    const first = await connect(canvasId, "ada@acme.com")
    if (first.socket === undefined || first.roster === undefined) {
      throw new Error("websocket missing")
    }
    await first.roster
    const secondJoin = nextRoster(first.socket)
    const second = await connect(canvasId, "ada@acme.com")
    if (second.socket === undefined || second.roster === undefined) {
      throw new Error("websocket missing")
    }
    const roster = await second.roster
    await secondJoin
    expect(roster.people).toHaveLength(1)
    expect(roster).toMatchObject({
      people: [{
        person: {
          personId: "person_154e1e0a1872533ddf397a16e5a65dcf",
          displayName: "ada"
        }
      }]
    })
  })

  it("rejects missing Access, a missing Canvas, and a non-upgrade request", async() => {
    const canvasId = "canvas_presence_auth"
    await share(canvasId)
    const unauthenticated = await SELF.fetch(presenceUrl(canvasId), {
      headers: { Upgrade: "websocket" }
    })
    const missing = await connect("canvas_presence_missing", "ada@acme.com")
    const document = await SELF.fetch(presenceUrl(canvasId), {
      headers: {
        "Cf-Access-Authenticated-User-Email": "ada@acme.com"
      }
    })

    expect(unauthenticated.status).toBe(401)
    expect(missing.response.status).toBe(404)
    expect(document.status).toBe(400)
  })
})
