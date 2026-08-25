import type { AcceptedAttribution } from "../identity.js"
import type { ConnectedPerson } from "../presence.js"

type IsAssignable<From, To> = [From] extends [To] ? true : false
type ExpectFalse<Value extends false> = Value

export type ConnectedPersonIsNotAcceptedAttribution = ExpectFalse<
  IsAssignable<ConnectedPerson, AcceptedAttribution>
>
