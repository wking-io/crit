import {
  AuthorityClock,
  AuthorityClockLive,
  AuthorityFailure,
  AuthorityView,
  authorityClockLayer,
  type CanvasNotFound,
  type ChangesAfter,
  type CreateCanvas,
  type CreateCanvasFailure,
  type CursorNotFound,
  type OpenCanvasFailure,
  type SubmitCanvasChangeFailure,
  type VerifiedInvocation
} from "@crit/authority"
import { AuthorityPolicy } from "@crit/authority/adapter"
import {
  CanvasId,
  DomainValue,
  IsoTimestamp
} from "@crit/domain"
import type {
  ChangePage,
  ProposedCanvasChange,
  SubmitChangeReceipt
} from "@crit/protocol"
import { DurableObject } from "cloudflare:workers"
import { Cause, Effect, Exit, Result, Schema } from "effect"

import { makeStorageSqlite } from "./durable-sqlite.js"
import {
  createOneCanvas,
  makeOneCanvas
} from "./one-canvas.js"
import { applyAuthoritySchema } from "./schema.js"
import { DurableSqlRowLimitExceeded } from "./stored-json.js"

type OneCanvasProposal = Omit<ProposedCanvasChange, "canvasId">
type OneCanvasChangesAfter = Omit<ChangesAfter, "canvasId">

export type DurableObjectResult<A, E> =
  | { readonly _tag: "success"; readonly value: A }
  | { readonly _tag: "failure"; readonly error: E }
  | { readonly _tag: "defect"; readonly message: string }
  | { readonly _tag: "interrupted" }
  | {
    readonly _tag: "durable-sql-row-limit-exceeded"
    readonly bytes: number
    readonly limit: number
  }

export const testClockPath = "/__crit_test_clock/"
export const testClockCancelPath = "/__crit_test_clock_cancel/"

const runResult = async <A, E>(
  effect: Effect.Effect<A, E>
): Promise<DurableObjectResult<A, E>> => {
  const exit = await Effect.runPromise(Effect.exit(effect))
  if (Exit.isSuccess(exit)) {
    return { _tag: "success", value: DomainValue.detach(exit.value) }
  }
  if (Cause.hasInterrupts(exit.cause)) return { _tag: "interrupted" }
  const failure = Cause.findError(exit.cause)
  if (Result.isSuccess(failure)) {
    return { _tag: "failure", error: DomainValue.detach(failure.success) }
  }
  const defect = Cause.findDefect(exit.cause)
  if (Result.isSuccess(defect) && defect.success instanceof DurableSqlRowLimitExceeded) {
    return {
      _tag: "durable-sql-row-limit-exceeded",
      bytes: defect.success.bytes,
      limit: defect.success.limit
    }
  }
  return { _tag: "defect", message: Cause.pretty(exit.cause) }
}

const callbackClock = (
  ctx: DurableObjectState,
  testClockId: string
) => authorityClockLayer(Effect.callback((resume) => {
  const requestId = crypto.randomUUID()
  void ctx.exports.default.fetch(
    new Request(
      `https://crit.invalid${testClockPath}${encodeURIComponent(testClockId)}/${requestId}`,
      { method: "POST" }
    )
  ).then(
    (response) => {
      if (!response.ok) {
        resume(Effect.die(
          new Error(`Test clock callback failed with status ${response.status}`)
        ))
        return
      }
      void response.text().then(
        (value) => resume(
          Effect.sync(() => Schema.decodeUnknownSync(IsoTimestamp)(value))
        ),
        (cause) => resume(Effect.die(cause))
      )
    },
    (cause) => resume(Effect.die(cause))
  )
  return Effect.promise(() => ctx.exports.default.fetch(
    new Request(`https://crit.invalid${testClockCancelPath}${requestId}`, {
      method: "DELETE"
    })
  )).pipe(
    Effect.asVoid,
    Effect.catchCause(() => Effect.void)
  )
}))

export class CanvasDurableObject extends DurableObject {
  private readonly activeRequests = new Set<string>()
  private readonly canceledRequests = new Set<string>()

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      Effect.runSync(applyAuthoritySchema(makeStorageSqlite(ctx.storage)))
    })
  }

  private get canvasId(): typeof CanvasId.Type {
    return Schema.decodeUnknownSync(CanvasId)(this.ctx.id.name)
  }

  private async result<A, E>(
    testClockId: string | undefined,
    effect: Effect.Effect<A, E, AuthorityClock>,
    requestId: string
  ): Promise<DurableObjectResult<A, E>> {
    const clock = testClockId === undefined
      ? AuthorityClockLive
      : callbackClock(this.ctx, testClockId)
    const program = effect.pipe(Effect.provide(clock))
    if (testClockId === undefined) return runResult(program)
    this.activeRequests.add(requestId)
    const canceled = Effect.promise(async () => {
      while (!this.canceledRequests.has(requestId)) {
        await scheduler.wait(1)
      }
    }).pipe(Effect.andThen(Effect.die("Durable Object request canceled")))
    try {
      return await runResult(Effect.raceFirst(program, canceled))
    } finally {
      this.activeRequests.delete(requestId)
      this.canceledRequests.delete(requestId)
    }
  }

  cancel(requestId: string): void {
    if (this.activeRequests.has(requestId)) {
      this.canceledRequests.add(requestId)
    }
  }

  create(
    command: CreateCanvas,
    invocation: VerifiedInvocation,
    testClockId?: string,
    requestId = crypto.randomUUID()
  ): Promise<DurableObjectResult<AuthorityView, CreateCanvasFailure>> {
    const sqlite = makeStorageSqlite(this.ctx.storage)
    const canvasId = this.canvasId
    return this.result(testClockId, Effect.gen(function*() {
      const clock = yield* AuthorityClock
      const existing = yield* Effect.result(makeOneCanvas({ canvasId, sqlite, clock }))
      if (Result.isSuccess(existing)) {
        return yield* Effect.fail(AuthorityFailure.canvasAlreadyExists({ canvasId }))
      }
      const createdAt = yield* clock.now
      const view = AuthorityPolicy.createCanvas({
        command: DomainValue.detach(command),
        invocation: DomainValue.detach(invocation),
        createdAt
      })
      yield* createOneCanvas({ view, sqlite, clock })
      return view
    }), requestId)
  }

  open(
    testClockId?: string,
    requestId = crypto.randomUUID()
  ): Promise<DurableObjectResult<AuthorityView, OpenCanvasFailure>> {
    const sqlite = makeStorageSqlite(this.ctx.storage)
    const canvasId = this.canvasId
    return this.result(testClockId, Effect.gen(function*() {
      const clock = yield* AuthorityClock
      const canvas = yield* makeOneCanvas({ canvasId, sqlite, clock })
      return yield* canvas.open()
    }), requestId)
  }

  submit(
    proposal: OneCanvasProposal,
    invocation: VerifiedInvocation,
    testClockId?: string,
    requestId = crypto.randomUUID()
  ): Promise<DurableObjectResult<SubmitChangeReceipt, SubmitCanvasChangeFailure>> {
    const sqlite = makeStorageSqlite(this.ctx.storage)
    const canvasId = this.canvasId
    return this.result(testClockId, Effect.gen(function*() {
      const clock = yield* AuthorityClock
      const canvas = yield* makeOneCanvas({ canvasId, sqlite, clock })
      return yield* canvas.submit(
        DomainValue.detach(proposal),
        DomainValue.detach(invocation)
      )
    }), requestId)
  }

  changesAfter(
    query: OneCanvasChangesAfter,
    testClockId?: string,
    requestId = crypto.randomUUID()
  ): Promise<DurableObjectResult<ChangePage, CursorNotFound | CanvasNotFound>> {
    const sqlite = makeStorageSqlite(this.ctx.storage)
    const canvasId = this.canvasId
    return this.result(testClockId, Effect.gen(function*() {
      const clock = yield* AuthorityClock
      const canvas = yield* makeOneCanvas({ canvasId, sqlite, clock })
      return yield* canvas.changesAfter(DomainValue.detach(query))
    }), requestId)
  }
}
