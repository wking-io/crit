import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { NodeServices } from "@effect/platform-node"
import { AuthorityModel } from "@crit/authority"
import {
  LocalBrowserConnection,
  LocalCanvasClient,
  LocalRepresentationClient
} from "@crit/client"
import { Id, WebUrlRepresentation, decodeCanvasCommandBatch } from "@crit/domain"
import { ReplicaModel } from "@crit/replica"
import { localApiVersionHeader } from "@crit/replica/http"
import { Context, Effect, Fiber, Layer, Option, Redacted, Result, Schema, Scope, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { describe, expect, it } from "vitest"
import { WebSocket } from "ws"

import { LocalDevelopment } from "../src/index.js"
import { LocalInstallation } from "../src/development.js"
import { decodeStored } from "../src/stored-json.js"

const browserOrigin = "http://127.0.0.1:5173"
const BrowserSessionResponse = Schema.Struct({ redirectTo: Schema.String })

const temporaryRoot = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "crit-browser-session-"))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
)

const start = (dataRoot: string, scope: Scope.Scope) => Layer.buildWithScope(
  LocalDevelopment.layer({ dataRoot, browserOrigin }).pipe(Layer.provide(NodeServices.layer)),
  scope
).pipe(Effect.map((context) => Context.get(context, LocalDevelopment)))

const bootstrapUrlOf = (development: Context.Tag.Service<LocalDevelopment>) => Option.match(
  development.browserBootstrapUrl,
  {
    onNone: () => "",
    onSome: Redacted.value
  }
)

const bootstrap = async (bootstrapUrl: string) => {
  const url = new URL(bootstrapUrl)
  const capability = url.hash.slice(1)
  url.hash = ""
  const document = await fetch(url)
  const documentText = await document.text()
  const response = await fetch(new URL("session", url), {
    method: "POST",
    headers: { "content-type": "application/json", origin: url.origin },
    body: JSON.stringify({ capability })
  })
  return { capability, document, documentText, response, url }
}

const cookiePair = (response: Response) => response.headers.get("set-cookie")?.split(";", 1)[0]

const rejectedSocketStatus = (url: string, cookie: string, origin?: string) => new Promise<number | undefined>((resolve, reject) => {
  const headers = origin === undefined ? { cookie } : { cookie, origin }
  const socket = new WebSocket(url, { headers })
  socket.once("unexpected-response", (_request, response) => {
    resolve(response.statusCode)
    socket.terminate()
  })
  socket.once("open", () => {
    socket.close()
    reject(new Error("expected WebSocket handshake rejection"))
  })
  socket.once("error", () => undefined)
})

const createCanvas = (args: {
  readonly baseUrl: string
  readonly instance: string
  readonly cookie?: string
  readonly origin?: string
  readonly canvasId?: string
}) => {
  const headers = new Headers({
    "content-type": "application/json",
    "x-crit-api-version": "1"
  })
  if (args.cookie !== undefined) headers.set("cookie", args.cookie)
  if (args.origin !== undefined) headers.set("origin", args.origin)
  return fetch(`${args.baseUrl}/browser/${args.instance}/api/v1/create`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      _tag: "create-canvas",
      canvasId: args.canvasId ?? "canvas_browser_session",
      title: "Browser session"
    })
  })
}

const resolveRepresentation = (args: {
  readonly baseUrl: string
  readonly instance: string
  readonly cookie?: string
  readonly origin?: string
  readonly version?: string
}) => {
  const headers = new Headers({
    "content-type": "application/json",
    "x-crit-api-version": args.version ?? "1"
  })
  if (args.cookie !== undefined) headers.set("cookie", args.cookie)
  if (args.origin !== undefined) headers.set("origin", args.origin)
  return fetch(`${args.baseUrl}/browser/${args.instance}/api/v1/representations/resolve`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      _tag: "resolve-representation",
      schemaVersion: 1,
      representation: { _tag: "web-url", url: "https://example.com/browser" }
    })
  })
}

describe("browser session HTTP protocol", () => {
  it("exchanges a fragment capability once and delegates to the Canvas API", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const dataRoot = join(directory, ".crit", "v1")
      const development = yield* start(dataRoot, yield* Effect.scope)
      const result = yield* Effect.promise(() => bootstrap(bootstrapUrlOf(development)))
      expect(result.document.status).toBe(200)
      expect(result.document.url).not.toContain(result.capability)
      expect(result.documentText).not.toContain(result.capability)
      expect(result.documentText).toContain('script src="bootstrap.js"')
      expect(result.document.headers.get("content-security-policy")).toContain("script-src 'self'")
      expect(result.document.headers.get("content-security-policy")).not.toContain("unsafe-inline")
      expect(result.response.status).toBe(200)
      const { redirectTo } = Schema.decodeUnknownSync(BrowserSessionResponse)(
        yield* Effect.promise(() => result.response.clone().json())
      )
      const redirect = new URL(redirectTo)
      expect(redirect.origin).toBe(browserOrigin)
      expect(redirect.search).toBe("")
      expect(redirectTo).not.toContain(result.capability)
      const cookie = cookiePair(result.response)
      expect(cookie).toBeDefined()
      expect(redirectTo).not.toContain(cookie ?? "missing-cookie")
      const sessionValue = cookie?.split("=", 2)[1]
      expect(sessionValue).toBeDefined()
      expect(redirectTo).not.toContain(sessionValue ?? "missing-session")
      expect(result.response.headers.get("set-cookie")).toContain("HttpOnly")
      expect(result.response.headers.get("set-cookie")).toContain("SameSite=Strict")
      expect(result.response.headers.get("set-cookie")).toContain(
        `Path=/browser/${development.descriptor.instance}/`
      )
      let requestCount = 0
      const sentSocketMessages: WebSocket.Data[] = []
      class BrowserWebSocket extends WebSocket {
        constructor(url: string, protocols?: string | string[]) {
          super(url, protocols ?? [], { headers: { cookie: cookie ?? "", origin: browserOrigin } })
        }

        override send(data: WebSocket.Data, cb?: (error?: Error) => void): void {
          sentSocketMessages.push(data)
          super.send(data, cb)
        }
      }
      const browserFetch = Layer.succeed(FetchHttpClient.Fetch, (input, init) => {
        expect(init?.credentials).toBe("include")
        const headers = new Headers(init?.headers)
        expect(headers.has("authorization")).toBe(false)
        requestCount += 1
        headers.set("cookie", cookie ?? "")
        headers.set("origin", browserOrigin)
        return fetch(input, { ...init, headers })
      })
      const decodedConnection = LocalBrowserConnection.decode(redirect.hash)
      const browserOptions = LocalBrowserConnection.options(Result.getOrThrow(decodedConnection))
      const resolved = yield* Effect.promise(() => resolveRepresentation({
        baseUrl: development.descriptor.baseUrl,
        instance: development.descriptor.instance,
        cookie,
        origin: browserOrigin
      }))
      expect(resolved.status).toBe(200)
      expect(yield* Effect.promise(() => resolved.json())).toMatchObject({
        _tag: "iframe",
        url: "https://example.com/browser"
      })
      const browserClientContext = yield* Layer.buildWithScope(
        Layer.merge(
          LocalCanvasClient.layer(browserOptions),
          LocalRepresentationClient.layer(browserOptions)
        ).pipe(
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(browserFetch)
        ),
        yield* Effect.scope
      )
      const browserClient = Context.get(browserClientContext, LocalCanvasClient)
      expect(yield* browserClient.status()).toMatchObject({ apiVersion: "1" })
      const browserPlan = yield* Context.get(browserClientContext, LocalRepresentationClient).resolve(
        WebUrlRepresentation.make({ url: "https://example.com/browser-client" })
      )
      expect(browserPlan).toMatchObject({ _tag: "iframe", url: "https://example.com/browser-client" })
      const canvasId = Id.canvas("canvas_browser_session")
      const browserView = yield* browserClient.create(AuthorityModel.createCanvas({
        canvasId,
        title: "Browser session"
      }))
      expect(browserView.projection.title).toBe("Browser session")
      expect((yield* browserClient.open(canvasId)).projection.title).toBe("Browser session")
      yield* Effect.scoped(Effect.gen(function*() {
        const notifications = yield* browserClient.subscribe(canvasId).pipe(
          Effect.provideService(Socket.WebSocketConstructor, (url, protocols) =>
            new BrowserWebSocket(url, protocols))
        )
        const notification = yield* notifications.pipe(Stream.runHead, Effect.forkChild)
        const changed = yield* browserClient.change(ReplicaModel.change({
          canvasId,
          commands: decodeCanvasCommandBatch([{
            _tag: "rename-canvas",
            expectedTitle: "Browser session",
            title: "Browser changed"
          }])
        }))
        expect(changed.view.projection.title).toBe("Browser changed")
        expect(yield* Fiber.join(notification)).toEqual(Option.some({
          kind: "replica-changed",
          schemaVersion: 1,
          canvasId
        }))
      }))
      const synced = yield* browserClient.sync(canvasId)
      expect(synced.view.projection.title).toBe("Browser changed")
      expect(synced.view.pending).toHaveLength(0)
      const reloadOptions = LocalBrowserConnection.options(Result.getOrThrow(
        LocalBrowserConnection.decode(new URL(redirectTo).hash)
      ))
      const reloadContext = yield* Layer.buildWithScope(
        LocalCanvasClient.layer(reloadOptions).pipe(
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(browserFetch)
        ),
        yield* Effect.scope
      )
      expect(yield* Context.get(reloadContext, LocalCanvasClient).status()).toMatchObject({ apiVersion: "1" })
      expect(sentSocketMessages).toEqual([])
      expect(requestCount).toBe(7)
      const corsCreated = yield* Effect.promise(() => createCanvas({
        baseUrl: development.descriptor.baseUrl,
        instance: development.descriptor.instance,
        cookie,
        origin: browserOrigin,
        canvasId: "canvas_browser_cors"
      }))
      expect(corsCreated.status).toBe(200)
      expect(corsCreated.headers.get("access-control-allow-origin")).toBe(browserOrigin)
      expect(corsCreated.headers.get("access-control-allow-credentials")).toBe("true")
      expect(corsCreated.headers.get("access-control-allow-origin")).not.toBe("*")
      const installation = decodeStored(
        LocalInstallation,
        readFileSync(join(dataRoot, "installation.json"), "utf8")
      )
      expect(redirectTo).not.toContain(installation.bearerSecret)
      const bearerView = yield* Effect.promise(() => fetch(
        `${development.descriptor.baseUrl}/api/v1/open/canvas_browser_session`,
        {
          headers: {
            authorization: `Bearer ${installation.bearerSecret}`,
            [localApiVersionHeader]: "1"
          }
        }
      ))
      expect(bearerView.status).toBe(200)
      const preflight = yield* Effect.promise(() => fetch(
        `${development.descriptor.baseUrl}/browser/${development.descriptor.instance}/api/v1/create`,
        {
          method: "OPTIONS",
          headers: {
            origin: browserOrigin,
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type,x-crit-api-version"
          }
        }
      ))
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get("access-control-allow-origin")).toBe(browserOrigin)
      expect(preflight.headers.get("access-control-allow-origin")).not.toBe("*")
      const opened = yield* Effect.promise(() => fetch(
        `${development.descriptor.baseUrl}/browser/${development.descriptor.instance}/api/v1/open/canvas_browser_session`,
        { headers: { cookie: cookie ?? "", "x-crit-api-version": "1" } }
      ))
      expect(opened.status).toBe(200)
      const replay = yield* Effect.promise(() => fetch(new URL("session", result.url), {
        method: "POST",
        headers: { "content-type": "application/json", origin: result.url.origin },
        body: JSON.stringify({ capability: result.capability })
      }))
      expect(replay.status).toBe(401)
    }))))

  it("allows exactly one concurrent bootstrap exchange", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const development = yield* start(join(directory, ".crit", "v1"), yield* Effect.scope)
      const url = new URL(bootstrapUrlOf(development))
      const capability = url.hash.slice(1)
      url.hash = ""
      const rejectedOrigin = yield* Effect.promise(() => fetch(new URL("session", url), {
        method: "POST",
        headers: { "content-type": "application/json", origin: browserOrigin },
        body: JSON.stringify({ capability })
      }))
      expect(rejectedOrigin.status).toBe(403)
      const malformed = yield* Effect.promise(() => fetch(new URL("session", url), {
        method: "POST",
        headers: { "content-type": "application/json", origin: url.origin },
        body: JSON.stringify({ capability: "short" })
      }))
      expect(malformed.status).toBe(400)
      const oversized = yield* Effect.promise(() => fetch(new URL("session", url), {
        method: "POST",
        headers: { "content-type": "application/json", origin: url.origin },
        body: JSON.stringify({ capability: "x".repeat(1_024) })
      }))
      expect(oversized.status).toBe(413)
      const request = () => fetch(new URL("session", url), {
        method: "POST",
        headers: { "content-type": "application/json", origin: url.origin },
        body: JSON.stringify({ capability })
      })
      const responses = yield* Effect.promise(() => Promise.all([request(), request()]))
      expect(responses.map((response) => response.status).sort()).toEqual([200, 401])
    }))))

  it("rejects the wrong host, origin, instance, session, and missing mutation origin", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const development = yield* start(join(directory, ".crit", "v1"), yield* Effect.scope)
      const result = yield* Effect.promise(() => bootstrap(bootstrapUrlOf(development)))
      const cookie = cookiePair(result.response)
      let sequence = 0
      const request = (overrides: Partial<Parameters<typeof createCanvas>[0]>) => createCanvas({
        baseUrl: development.descriptor.baseUrl,
        instance: development.descriptor.instance,
        cookie,
        origin: browserOrigin,
        canvasId: `canvas_browser_rejection_${sequence++}`,
        ...overrides
      })
      expect((yield* Effect.promise(() => request({
        baseUrl: development.descriptor.baseUrl.replace("127.0.0.1", "localhost")
      }))).status).toBe(403)
      expect((yield* Effect.promise(() => request({ origin: "http://neighbor.example" }))).status).toBe(403)
      expect((yield* Effect.promise(() => request({ origin: result.url.origin }))).status).toBe(403)
      expect((yield* Effect.promise(() => request({ instance: "ffffffffffffffffffffffffffffffff" }))).status).toBe(404)
      expect((yield* Effect.promise(() => request({ cookie: "crit_session_wrong=wrong" }))).status).toBe(401)
      expect((yield* Effect.promise(() => request({ cookie: undefined }))).status).toBe(401)
      expect((yield* Effect.promise(() => request({ origin: undefined }))).status).toBe(403)
      const representationRequest = (overrides: Partial<Parameters<typeof resolveRepresentation>[0]>) =>
        resolveRepresentation({
          baseUrl: development.descriptor.baseUrl,
          instance: development.descriptor.instance,
          cookie,
          origin: browserOrigin,
          ...overrides
        })
      const wrongSession = yield* Effect.promise(() => representationRequest({
        cookie: "crit_session_wrong=wrong"
      }))
      expect(wrongSession.status).toBe(401)
      expect(wrongSession.headers.get("access-control-allow-origin")).toBe(browserOrigin)
      expect((yield* Effect.promise(() => representationRequest({ cookie: undefined }))).status).toBe(401)
      const wrongOrigin = yield* Effect.promise(() => representationRequest({
        origin: "http://neighbor.example"
      }))
      expect(wrongOrigin.status).toBe(403)
      expect(wrongOrigin.headers.get("access-control-allow-origin")).toBeNull()
      const missingOrigin = yield* Effect.promise(() => representationRequest({ origin: undefined }))
      expect(missingOrigin.status).toBe(403)
      expect(missingOrigin.headers.get("access-control-allow-origin")).toBeNull()
      const wrongRepresentationVersion = yield* Effect.promise(() => representationRequest({ version: "2" }))
      expect(wrongRepresentationVersion.status).toBe(426)
      expect(wrongRepresentationVersion.headers.get("access-control-allow-origin")).toBe(browserOrigin)
      const socketPath = `${development.descriptor.baseUrl}/browser/${development.descriptor.instance}/api/v1/subscribe/canvas_missing`
      const webSocketPath = socketPath.replace("http://", "ws://")
      expect(yield* Effect.promise(() => rejectedSocketStatus(
        webSocketPath,
        cookie ?? "",
        "http://neighbor.example"
      ))).toBe(403)
      expect(yield* Effect.promise(() => rejectedSocketStatus(
        webSocketPath,
        "crit_session_wrong=wrong",
        browserOrigin
      ))).toBe(401)
      expect(yield* Effect.promise(() => rejectedSocketStatus(
        webSocketPath,
        cookie ?? ""
      ))).toBe(403)
      expect((yield* Effect.promise(() => fetch(socketPath))).status).toBe(400)
      const wrongVersion = yield* Effect.promise(() => fetch(
        `${development.descriptor.baseUrl}/browser/${development.descriptor.instance}/api/v1/open/canvas_missing`,
        {
          headers: {
            cookie: cookie ?? "",
            origin: browserOrigin,
            "x-crit-api-version": "2"
          }
        }
      ))
      expect(wrongVersion.status).toBe(426)
    }))))

  it("keeps daemon sessions separate in one cookie jar and invalidates them on restart", () =>
    Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const directory = yield* temporaryRoot
      const firstRoot = join(directory, "first", ".crit", "v1")
      const secondRoot = join(directory, "second", ".crit", "v1")
      let oldCookie = ""
      let oldBootstrap = ""
      yield* Effect.scoped(Effect.gen(function*() {
        const scope = yield* Effect.scope
        const first = yield* start(firstRoot, scope)
        const second = yield* start(secondRoot, scope)
        const firstUrl = bootstrapUrlOf(first)
        const secondUrl = bootstrapUrlOf(second)
        const firstBootstrap = yield* Effect.promise(() => bootstrap(firstUrl))
        const secondBootstrap = yield* Effect.promise(() => bootstrap(secondUrl))
        oldCookie = cookiePair(firstBootstrap.response) ?? ""
        oldBootstrap = firstUrl
        const jar = `${oldCookie}; ${cookiePair(secondBootstrap.response)}`
        expect(cookiePair(firstBootstrap.response)?.split("=", 1)[0]).not.toBe(
          cookiePair(secondBootstrap.response)?.split("=", 1)[0]
        )
        const firstCreate = yield* Effect.promise(() => createCanvas({
          baseUrl: first.descriptor.baseUrl,
          instance: first.descriptor.instance,
          cookie: jar,
          origin: browserOrigin,
          canvasId: "canvas_first_daemon"
        }))
        const secondCreate = yield* Effect.promise(() => createCanvas({
          baseUrl: second.descriptor.baseUrl,
          instance: second.descriptor.instance,
          cookie: jar,
          origin: browserOrigin,
          canvasId: "canvas_second_daemon"
        }))
        expect(firstCreate.status).toBe(200)
        expect(secondCreate.status).toBe(200)
      }))
      const restarted = yield* start(firstRoot, yield* Effect.scope)
      expect(bootstrapUrlOf(restarted)).not.toBe(oldBootstrap)
      const rejected = yield* Effect.promise(() => createCanvas({
        baseUrl: restarted.descriptor.baseUrl,
        instance: restarted.descriptor.instance,
        cookie: oldCookie,
        origin: browserOrigin,
        canvasId: "canvas_restarted_daemon"
      }))
      expect(rejected.status).toBe(401)
      expect(readFileSync(join(firstRoot, "daemon.json"), "utf8")).not.toContain("#")
      const oldCapability = new URL(oldBootstrap).hash.slice(1)
      expect(readFileSync(join(firstRoot, "daemon.json"), "utf8")).not.toContain(oldCapability)
      expect(readFileSync(join(firstRoot, "installation.json"), "utf8")).not.toContain(oldCapability)
    }))))
})
