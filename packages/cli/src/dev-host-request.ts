import { DevHostRequest } from "@crit/local"
import { Option, Result, Schema } from "effect"

import { hostListenPort } from "./host-app.js"

export class CliOperationalFailure extends Schema.TaggedError<CliOperationalFailure>()(
  "CliOperationalFailure",
  { message: Schema.String }
) {}

export const parseDevHostRequest = (flags: {
  readonly browserOrigin: Option.Option<string>
  readonly noHost: boolean
}, environment: Readonly<Record<string, string | undefined>> = process.env): Result.Result<DevHostRequest, CliOperationalFailure> => {
  if (Option.isSome(flags.browserOrigin) && flags.noHost) {
    return Result.fail(new CliOperationalFailure({
      message: "--browser-origin and --no-host cannot be combined"
    }))
  }
  if (Option.isSome(flags.browserOrigin)) {
    return Result.succeed(DevHostRequest.Standalone({
      browserOrigin: flags.browserOrigin.value
    }))
  }
  if (flags.noHost) return Result.succeed(DevHostRequest.None())
  try {
    const port = hostListenPort(environment)
    return Result.succeed(DevHostRequest.Integrated({
      hostOrigin: environment.PORTLESS_URL ?? `http://127.0.0.1:${port}`
    }))
  } catch (cause) {
    return Result.fail(new CliOperationalFailure({
      message: cause instanceof Error ? cause.message : "Invalid host configuration"
    }))
  }
}
