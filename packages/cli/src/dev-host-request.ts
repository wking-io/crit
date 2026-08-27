import { DevHostRequest } from "@crit/local"
import { Option, Result, Schema } from "effect"

import { HOST_ORIGIN } from "./host-app.js"

export class CliOperationalFailure extends Schema.TaggedError<CliOperationalFailure>()(
  "CliOperationalFailure",
  { message: Schema.String }
) {}

export const parseDevHostRequest = (flags: {
  readonly browserOrigin: Option.Option<string>
  readonly noHost: boolean
}): Result.Result<DevHostRequest, CliOperationalFailure> => {
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
  return Result.succeed(DevHostRequest.Integrated({ hostOrigin: HOST_ORIGIN }))
}
