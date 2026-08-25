import { Effect, Exit, type Cause, type Context } from "effect"
import {
  classifySqliteError,
  SqlError
} from "effect/unstable/sql/SqlError"

export interface DurableSqlite {
  readonly transact: <A, E, R>(
    body: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | SqlError, R>
  readonly sql: {
    <A>(
      strings: TemplateStringsArray,
      ...args: unknown[]
    ): Effect.Effect<ReadonlyArray<A>, SqlError>
  }
  readonly unsafe: <A>(
    query: string,
    ...args: unknown[]
  ) => Effect.Effect<ReadonlyArray<A>, SqlError>
}

const sqlError = (cause: unknown, query: string) => new SqlError({
  reason: classifySqliteError(cause, {
    message: "Failed to execute Durable Object SQL",
    operation: query
  })
})

const execute = <A>(
  storage: DurableObjectStorage,
  query: string,
  args: ReadonlyArray<unknown>
): Effect.Effect<ReadonlyArray<A>, SqlError> => Effect.try({
  try: () => storage.sql.exec(query, ...args).toArray() as unknown as ReadonlyArray<A>,
  catch: (cause) => sqlError(cause, query)
})

const compile = (
  strings: TemplateStringsArray,
  args: ReadonlyArray<unknown>
) => ({
  query: strings.slice(1).reduce(
    (query, part) => `${query}?${part}`,
    strings[0] ?? ""
  ),
  args
})

export const makeStorageSqlite = (
  storage: DurableObjectStorage
): DurableSqlite => {
  const unsafe: DurableSqlite["unsafe"] = (query, ...args) =>
    execute(storage, query, args)

  const sql: DurableSqlite["sql"] = (strings, ...args) => {
    const statement = compile(strings, args)
    return execute(storage, statement.query, statement.args)
  }

  const transact: DurableSqlite["transact"] = <A, E, R>(
    body: Effect.Effect<A, E, R>
  ) => Effect.withFiber<A, E | SqlError, R>((fiber) =>
    Effect.suspend<A, E | SqlError, never>(() => {
      const rollback = new Error("Durable Object transaction body failed")
      let failure: Cause.Cause<E> | undefined
      try {
        const value = storage.transactionSync(() => {
          const context = fiber.context as Context.Context<R>
          const exit = Effect.runSyncExitWith(context)(body)
          if (Exit.isFailure(exit)) {
            failure = exit.cause
            throw rollback
          }
          return exit.value
        })
        return Effect.succeed(value)
      } catch (cause) {
        if (cause === rollback) {
          return failure === undefined
            ? Effect.die("Durable Object transaction lost its failure cause")
            : Effect.failCause(failure)
        }
        return Effect.fail(sqlError(cause, "transactionSync"))
      }
    }))

  return { transact, sql, unsafe }
}
