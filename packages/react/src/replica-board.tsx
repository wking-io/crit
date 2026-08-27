import {
  presenceKey,
  type CanvasChangeFailure,
  type CanvasCommandBatch,
  type ExecutionId,
  type PresenceRoster,
  type ReportedRuntime
} from "@crit/domain"
import type { ReplicaView } from "@crit/replica"
import { Data, Match, Predicate } from "effect"
import type { ReactElement } from "react"

import type { CanvasCamera } from "./canvas-camera.js"
import { CanvasBoard } from "./canvas-board.js"
import type { CanvasSelection } from "./canvas-selection.js"
import type { FrameRepresentationResolver } from "./frame-renderer.js"
import type { FrameSnapshotter } from "./frame-snapshot.js"
import type {
  ReplicaChangeRejected,
  ReplicaConnection,
  ReplicaSessionUnavailable
} from "./replica-session.js"
import type { ReviewClientEffect } from "./review-actions.js"

interface ReplicaBoardBaseProps {
  readonly view: ReplicaView
  readonly resolver: FrameRepresentationResolver
  readonly camera: CanvasCamera
  readonly onCameraChange: (camera: CanvasCamera) => void
  readonly selection: CanvasSelection
  readonly onSelectionChange: (selection: CanvasSelection) => void
  readonly presence?: PresenceRoster | undefined
  readonly connection?: ReplicaConnection | undefined
  readonly notice?: ReplicaChangeRejected | ReplicaSessionUnavailable | undefined
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

type ReplicaBoardStatus = Data.TaggedEnum<{
  readonly synchronized: {}
  readonly outstanding: {
    readonly changes: readonly [PendingChange, ...PendingChange[]]
  }
}>
const ReplicaBoardStatus = Data.taggedEnum<ReplicaBoardStatus>()

const statusFromPending = (pending: ReplicaView["pending"]): ReplicaBoardStatus => {
  const [first, ...rest] = pending
  if (first === undefined) return ReplicaBoardStatus.synchronized()
  return ReplicaBoardStatus.outstanding({ changes: [first, ...rest] })
}

const changeCount = (count: number): string =>
  count === 1 ? "1 change" : `${count} changes`

const conflictCopy = (failure: CanvasChangeFailure): string =>
  Match.value(failure).pipe(Match.tagsExhaustive({
    "canvasMismatch": () => "Rejected because it targets a different Canvas.",
    "canvasTitleMismatch": () =>
      "Rejected because the Canvas title changed since this was proposed.",
    "entityNotFound": ({ entity }) =>
      `Rejected because its ${entity} no longer exists.`,
    "idAlreadyIssued": ({ entity }) =>
      `Rejected because its new ${entity} id was already taken.`,
    "preconditionFailed": ({ field }) =>
      `Rejected because ${field} changed since this was proposed.`,
    "invalidReference": ({ field }) =>
      `Rejected because ${field} points at a missing item.`
  }))

const entryStateCopy = (state: PendingChange["state"]): string =>
  Match.value(state).pipe(Match.tagsExhaustive({
    ready: () => "Waiting to sync.",
    "acceptedUnconfirmed": () => "Accepted, awaiting confirmation.",
    conflicted: ({ failure }) => conflictCopy(failure),
    blocked: ({ blockedBy }) =>
      `Blocked by ${changeCount(blockedBy.length)} ahead of it.`
  }))

const authorCopy = (author: PendingChange["author"]): string =>
  Match.value(author).pipe(Match.tagsExhaustive({
    person: ({ displayName }) => `Proposed by ${displayName}.`,
    agent: ({ displayName, runBy }) => `Proposed by Agent ${displayName}. Run by ${runBy}.`
  }))

const runtimeCopy = (runtime: ReportedRuntime | undefined): string => {
  if (runtime === undefined) return ""
  const harness = runtime.harness.version === undefined
    ? runtime.harness.name
    : `${runtime.harness.name} ${runtime.harness.version}`
  const model = runtime.model === undefined
    ? undefined
    : runtime.model.version === undefined
      ? runtime.model.name
      : `${runtime.model.name} ${runtime.model.version}`
  const via = model === undefined ? `Via reported ${harness}.` : `Via reported ${harness} (${model}).`
  const session = runtime.sessionId === undefined ? undefined : `Reported session ${runtime.sessionId}.`
  const task = runtime.taskId === undefined ? undefined : `Reported task ${runtime.taskId}.`
  return [via, session, task].filter((part) => part !== undefined).join(" ")
}

const executionCopy = (executionId: ExecutionId): string => {
  const visible = executionId.length > 14 ? `${executionId.slice(0, 14)}…` : executionId
  return `Run ${visible}`
}

const entryCopy = (change: PendingChange): string =>
  Match.value(change.author).pipe(Match.tagsExhaustive({
    person: (author) => `${entryStateCopy(change.state)} ${authorCopy(author)}`,
    agent: (author) => {
      const runtime = runtimeCopy(author.reportedRuntime)
      const execution = executionCopy(author.executionId)
      return runtime === ""
        ? `${entryStateCopy(change.state)} ${authorCopy(author)} ${execution}`
        : `${entryStateCopy(change.state)} ${authorCopy(author)} ${runtime} ${execution}`
    }
  }))

const connectedPersonCopy = (
  person: PresenceRoster["people"][number]
): string => person.person.displayName

const outstandingHeadline = (
  title: ReplicaView["projection"]["title"],
  changes: readonly [PendingChange, ...PendingChange[]]
): string => {
  if (changes.some((change) => Predicate.isTagged(change.state, "conflicted"))) {
    return `${title} has conflicted changes.`
  }
  if (changes.some((change) => Predicate.isTagged(change.state, "blocked"))) {
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
  ReplicaBoardStatus.$is("outstanding")(status) &&
    status.changes.some((change) => Predicate.isTagged(change.state, "conflicted"))
    ? "alert"
    : "status"

const connectionAlert = (
  connection: ReplicaConnection | undefined
): string | undefined => connection === undefined
  ? undefined
  : Match.value(connection).pipe(Match.tagsExhaustive({
    live: () => undefined,
    lost: ({ reason }) =>
      `Connection lost. ${reason} Showing the last known state.`
  }))

const noticeAlert = (
  notice: ReplicaChangeRejected | ReplicaSessionUnavailable | undefined
): string | undefined => notice === undefined
  ? undefined
  : Match.value(notice).pipe(Match.tagsExhaustive({
    ReplicaChangeRejected: ({ failure }) =>
      `Your last edit was not applied. ${conflictCopy(failure)}`,
    ReplicaSessionUnavailable: ({ reason }) =>
      `Your last edit was not applied. ${reason}`
  }))

const connectionAllowsMutation = (
  connection: ReplicaConnection | undefined
): boolean => connection === undefined ||
  Match.value(connection).pipe(Match.tagsExhaustive({
    live: () => true,
    lost: () => false
  }))

const replicaClassName = (className: string | undefined): string =>
  className === undefined ? "crit-replica" : `crit-replica ${className}`

export function ReplicaBoard({
  camera,
  className,
  connection,
  onCameraChange,
  onEffect,
  onSelectionChange,
  onSubmit,
  notice,
  presence,
  resolver,
  selection,
  snapshotter,
  view
}: ReplicaBoardProps): ReactElement {
  const status = statusFromPending(view.pending)
  const showPresence = presence !== undefined && presence.people.length > 0
  const connectionCopy = connectionAlert(connection)
  const noticeCopy = noticeAlert(notice)
  const mutation = onSubmit !== undefined && snapshotter !== undefined
    ? {
      mutable: connectionAllowsMutation(connection),
      onSubmit,
      snapshotter
    }
    : {}
  const alerts = [connectionCopy, noticeCopy].filter(
    (copy): copy is string => copy !== undefined
  )
  return (
    <div className={replicaClassName(className)}>
      {alerts.length === 0
        ? null
        : (
          <div className="crit-replica__alerts">
            {alerts.map((copy) => <p key={copy} role="alert">{copy}</p>)}
          </div>
        )}
      {showPresence
        ? (
          <section
            aria-label={`${view.projection.title} presence`}
            className="crit-replica__presence"
            role="status"
          >
            <ul>
              {presence.people.map((person) => (
                <li key={presenceKey(person)}>{connectedPersonCopy(person)}</li>
              ))}
            </ul>
          </section>
        )
        : null}
      <section
        aria-label={`${view.projection.title} sync status`}
        className="crit-replica__sync"
      >
        <p className="crit-save-state" role={statusTone(status)}>
          {statusCopy(view.projection.title, status)}
        </p>
        {ReplicaBoardStatus.$is("outstanding")(status)
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
        camera={camera}
        onCameraChange={onCameraChange}
        onEffect={onEffect}
        onSelectionChange={onSelectionChange}
        projection={view.projection}
        resolver={resolver}
        selection={selection}
        {...mutation}
      />
    </div>
  )
}
