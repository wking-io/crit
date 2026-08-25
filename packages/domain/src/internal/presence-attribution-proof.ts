import type { AcceptedAttribution } from "../identity.js"
import type {
  ActiveAgentExecution,
  ConnectedPerson,
  PresenceParticipant
} from "../presence.js"

type IsAssignable<From, To> = [From] extends [To] ? true : false
type ExpectFalse<Value extends false> = Value

export type ConnectedPersonIsNotAcceptedAttribution = ExpectFalse<
  IsAssignable<ConnectedPerson, AcceptedAttribution>
>
export type ActiveAgentExecutionIsNotAcceptedAttribution = ExpectFalse<
  IsAssignable<ActiveAgentExecution, AcceptedAttribution>
>
export type PresenceParticipantIsNotAcceptedAttribution = ExpectFalse<
  IsAssignable<PresenceParticipant, AcceptedAttribution>
>
