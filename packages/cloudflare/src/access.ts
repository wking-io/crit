import { EmailAddress } from "@crit/domain"
import { Option, Schema } from "effect"

export const accessEmailHeader = "Cf-Access-Authenticated-User-Email"

export const readAccessEmail = (request: Request): Option.Option<EmailAddress> =>
  Schema.decodeUnknownOption(EmailAddress)(request.headers.get(accessEmailHeader))
