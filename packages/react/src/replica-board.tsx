import {
  presenceKey,
  type CanvasChangeFailure,
  type CanvasCommandBatch,
  type PresenceRoster
} from "@crit/domain"
import type { ReplicaView } from "@crit/replica"
import { Match } from "effect"
import type { ReactElement } from "react"

import type { CanvasCamera } from "./canvas-camera.js"
import { CanvasBoard } from "./canvas-board.js"
import type { CanvasSelection } from "./canvas-selection.js"
import type { FrameRepresentationResolver } from "./frame-renderer.js"
import type { FrameSnapshotter } from "./frame-snapshot.js"
import type { ReviewClientEffect } from "./review-actions.js"

interface ReplicaBoardBaseProps {
  readonly view: ReplicaView
  readonly resolver: FrameRepresentationResolver
  readonly camera: CanvasCamera
  readonly onCameraChange: (camera: CanvasCamera) => void
  readonly selection: CanvasSelection
  readonly onSelectionChange: (selection: CanvasSelection) => void
  readonly presence?: PresenceRoster | undefined
  readonly onEffect?: (effect: ReviewClientEffect) => void
  readonly className?: string
}

type ReplicaBoardReviewProps =
  | {
    readonly onSubmit: (commands: CanvasCommandBatch) => void
    readonly snapshotter: FrameSnapshotter
  }
  | {
    readonly onSubmit?: undefined
    readonly snapshotter?: undefined
  }

export type ReplicaBoardProps = ReplicaBoardBaseProps & ReplicaBoardReviewProps

type PendingChange = ReplicaView["pending"][number]

type ReplicaBoardStatus =
  | { readonly _tag: "synchronized" }
  | {
    readonly _tag: "outstanding"
    readonly changes: readonly [PendingChange, ...PendingChange[]]
  }

const statusFromPending = (pending: ReplicaView["pending"]): ReplicaBoardStatus => {
  const [first, ...rest] = pending
  if (first === undefined) return { _tag: "synchronized" }
  return { _tag: "outstanding", changes: [first, ...rest] }
}

const changeCount = (count: number): string =>
  count === 1 ? "1 change" : `${count} changes`

const conflictCopy = (failure: CanvasChangeFailure): string =>
  Match.value(failure).pipe(Match.tagsExhaustive({
    "canvas-mismatch": () => "Rejected because it targets a different Canvas.",
    "canvas-title-mismatch": () =>
      "Rejected because the Canvas title changed since this was proposed.",
    "entity-not-found": ({ entity }) =>
      `Rejected because its ${entity} no longer exists.`,
    "id-already-issued": ({ entity }) =>
      `Rejected because its new ${entity} id was already taken.`,
    "precondition-failed": ({ field }) =>
      `Rejected because ${field} changed since this was proposed.`,
    "invalid-reference": ({ field }) =>
      `Rejected because ${field} points at a missing item.`
  }))

const entryStateCopy = (state: PendingChange["state"]): string =>
  Match.value(state).pipe(Match.tagsExhaustive({
    ready: () => "Waiting to sync.",
    "accepted-unconfirmed": () => "Accepted, awaiting confirmation.",
    conflicted: ({ failure }) => conflictCopy(failure),
    blocked: ({ blockedBy }) =>
      `Blocked by ${changeCount(blockedBy.length)} ahead of it.`
  }))

const entryCopy = (change: PendingChange): string =>
  `${entryStateCopy(change.state)} Proposed by ${change.author.displayName}.`

const connectedPersonCopy = (
  person: PresenceRoster["people"][number]
): string => person.person.displayName

const activeAgentExecutionCopy = (
  execution: PresenceRoster["agentRuns"][number]
): string =>
  `${execution.agent.displayName}, run by ${execution.delegatedBy.displayName}`

const outstandingHeadline = (
  title: ReplicaView["projection"]["title"],
  changes: readonly [PendingChange, ...PendingChange[]]
): string => {
  if (changes.some((change) => change.state._tag === "conflicted")) {
    return `${title} has conflicted changes.`
  }
  if (changes.some((change) => change.state._tag === "blocked")) {
    return `${title} has blocked changes.`
  }
  return `${title} has pending changes.`
}

const statusCopy = (
  title: ReplicaView["projection"]["title"],
  status: ReplicaBoardStatus
): string =>
  Match.value(status).pipe(Match.tagsExhaustive({
    synchronized: () => `${title} is synchronized.`,
    outstanding: ({ changes }) => outstandingHeadline(title, changes)
  }))

const statusTone = (status: ReplicaBoardStatus): "status" | "alert" =>
  status._tag === "outstanding" &&
    status.changes.some((change) => change.state._tag === "conflicted")
    ? "alert"
    : "status"

export function ReplicaBoard({
  camera,
  className,
  onCameraChange,
  onEffect,
  onSelectionChange,
  onSubmit,
  presence,
  resolver,
  selection,
  snapshotter,
  view
}: ReplicaBoardProps): ReactElement {
  const status = statusFromPending(view.pending)
  const showPresence = presence !== undefined &&
    (presence.people.length > 0 || presence.agentRuns.length > 0)
  return (
    <div className={className}>
      {showPresence
        ? (
          <section
            aria-label={`${view.projection.title} presence`}
            role="status"
          >
            <ul>
              {presence.people.map((person) => (
                <li key={presenceKey(person)}>{connectedPersonCopy(person)}</li>
              ))}
              {presence.agentRuns.map((execution) => (
                <li key={presenceKey(execution)}>
                  {activeAgentExecutionCopy(execution)}
                </li>
              ))}
            </ul>
          </section>
        )
        : null}
      <section aria-label={`${view.projection.title} sync status`}>
        <p role={statusTone(status)}>{statusCopy(view.projection.title, status)}</p>
        {status._tag === "outstanding"
          ? (
            <ul>
              {status.changes.map((change) => (
                <li key={change.proposal.changeId}>{entryCopy(change)}</li>
              ))}
            </ul>
          )
          : null}
      </section>
      <CanvasBoard
        {...(onSubmit === undefined || snapshotter === undefined
          ? {}
          : { onSubmit, snapshotter })}
        camera={camera}
        onCameraChange={onCameraChange}
        {...(onEffect === undefined ? {} : { onEffect })}
        onSelectionChange={onSelectionChange}
        projection={view.projection}
        resolver={resolver}
        selection={selection}
      />
    </div>
  )
}
