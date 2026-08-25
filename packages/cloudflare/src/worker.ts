import { EmailAddress, type IsoTimestamp } from "@crit/domain"
import { encodeAccessAuthenticatedPersonWire } from "@crit/protocol"
import { Effect, Exit, Option, Schema } from "effect"

import {
  CanvasDurableObject,
  testClockCancelPath,
  testClockPath
} from "./canvas-object.js"

const testClocks = new Map<string, Effect.Effect<IsoTimestamp>>()
const runningClocks = new Map<string, string>()
const canceledClocks = new Set<string>()

interface RegisteredTestClock {
  readonly id: string
  readonly close: () => void
}

export const registerTestClock = (
  now: Effect.Effect<IsoTimestamp>
): RegisteredTestClock => {
  const id = crypto.randomUUID()
  testClocks.set(id, now)
  return {
    id,
    close: () => {
      testClocks.delete(id)
      for (const [requestId, testClockId] of runningClocks) {
        if (testClockId === id) canceledClocks.add(requestId)
      }
    }
  }
}

const worker: ExportedHandler<Cloudflare.Env> = {
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/identity") {
      if (request.method !== "GET") {
        return new Response(null, { status: 405 })
      }
      const address = Schema.decodeUnknownOption(EmailAddress)(
        request.headers.get("Cf-Access-Authenticated-User-Email")
      )
      if (Option.isNone(address)) {
        return new Response(null, { status: 401 })
      }
      const body = encodeAccessAuthenticatedPersonWire({
        kind: "access-authenticated-person",
        schemaVersion: 1,
        address: address.value
      })
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" }
      })
    }
    if (
      request.method === "DELETE" &&
      url.pathname.startsWith(testClockCancelPath)
    ) {
      const requestId = url.pathname.slice(testClockCancelPath.length)
      if (runningClocks.has(requestId)) {
        canceledClocks.add(requestId)
        while (runningClocks.has(requestId)) {
          await scheduler.wait(1)
        }
      }
      return new Response(null, { status: 204 })
    }
    if (request.method !== "POST" || !url.pathname.startsWith(testClockPath)) {
      return new Response(null, { status: 404 })
    }
    const [encodedClockId, requestId] = url.pathname
      .slice(testClockPath.length)
      .split("/")
    if (encodedClockId === undefined || requestId === undefined) {
      return new Response(null, { status: 404 })
    }
    const testClockId = decodeURIComponent(encodedClockId)
    const clock = testClocks.get(testClockId)
    if (clock === undefined) {
      return new Response(null, { status: 404 })
    }
    runningClocks.set(requestId, testClockId)
    const canceled = Effect.promise(async () => {
      while (!canceledClocks.has(requestId)) {
        await scheduler.wait(1)
      }
    }).pipe(Effect.andThen(Effect.die("Test clock request canceled")))
    try {
      const exit = await Effect.runPromise(Effect.exit(
        Effect.raceFirst(clock, canceled)
      ))
      return Exit.isSuccess(exit)
        ? new Response(exit.value)
        : new Response(null, { status: 500 })
    } finally {
      runningClocks.delete(requestId)
      canceledClocks.delete(requestId)
    }
  }
}

export { CanvasDurableObject }
export default worker
