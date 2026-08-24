import { Id } from "@crit/domain"
import type { ReplicaSessionHandle } from "@crit/react"
import { Match, Result } from "effect"
import { useState, type FormEvent, type ReactElement } from "react"

import { newFrameCommand, nextFrameGeometry } from "./new-frame.js"

type NewFrameChrome =
  | { readonly _tag: "idle" }
  | {
    readonly _tag: "composing"
    readonly url: string
    readonly title: string
    readonly error: string | null
  }
  | { readonly _tag: "submitting"; readonly url: string; readonly title: string }

const idle: NewFrameChrome = { _tag: "idle" }

const composing = (
  url: string,
  title: string,
  error: string | null
): NewFrameChrome => ({ _tag: "composing", url, title, error })

export function NewFrameForm({
  frameCount,
  submit
}: {
  readonly frameCount: number
  readonly submit: ReplicaSessionHandle["submit"]
}): ReactElement {
  const [chrome, setChrome] = useState<NewFrameChrome>(idle)

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (chrome._tag !== "composing") return
    const { title, url } = chrome
    const parsed = newFrameCommand({
      url,
      title,
      frameId: Id.frame(`frame_${crypto.randomUUID().replaceAll("-", "")}`),
      geometry: nextFrameGeometry(frameCount)
    })
    if (Result.isFailure(parsed)) {
      setChrome(composing(url, title, parsed.failure.reason))
      return
    }
    setChrome({ _tag: "submitting", url, title })
    void submit([parsed.success]).then((submitted) => {
      if (Result.isSuccess(submitted)) {
        setChrome(idle)
        return
      }
      setChrome(composing(url, title, Match.value(submitted.failure).pipe(
        Match.tagsExhaustive({
          ReplicaChangeRejected: () => "The daemon rejected this frame.",
          ReplicaSessionUnavailable: (failure) => failure.reason
        })
      )))
    })
  }

  return Match.value(chrome).pipe(Match.tagsExhaustive({
    idle: () => (
      <button onClick={() => setChrome(composing("", "", null))} type="button">
        Add Frame
      </button>
    ),
    composing: (state) => (
      <NewFrameFields
        error={state.error}
        onCancel={() => setChrome(idle)}
        onSubmit={onSubmit}
        onTitleChange={(title) => setChrome(composing(state.url, title, state.error))}
        onUrlChange={(url) => setChrome(composing(url, state.title, state.error))}
        submitting={false}
        title={state.title}
        url={state.url}
      />
    ),
    submitting: (state) => (
      <NewFrameFields
        error={null}
        onCancel={() => setChrome(idle)}
        onSubmit={onSubmit}
        onTitleChange={() => undefined}
        onUrlChange={() => undefined}
        submitting
        title={state.title}
        url={state.url}
      />
    )
  }))
}

function NewFrameFields({
  error,
  onCancel,
  onSubmit,
  onTitleChange,
  onUrlChange,
  submitting,
  title,
  url
}: {
  readonly error: string | null
  readonly onCancel: () => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
  readonly onTitleChange: (title: string) => void
  readonly onUrlChange: (url: string) => void
  readonly submitting: boolean
  readonly title: string
  readonly url: string
}): ReactElement {
  return (
    <form onSubmit={onSubmit}>
      <label>
        URL
        <input
          name="url"
          onChange={(event) => onUrlChange(event.currentTarget.value)}
          required
          type="text"
          value={url}
        />
      </label>
      <label>
        Title
        <input
          name="title"
          onChange={(event) => onTitleChange(event.currentTarget.value)}
          placeholder="Inferred from URL"
          type="text"
          value={title}
        />
      </label>
      {error === null ? null : <p role="alert">{error}</p>}
      <button disabled={submitting} type="submit">Add</button>
      <button onClick={onCancel} type="button">Cancel</button>
    </form>
  )
}
