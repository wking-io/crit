import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type PointerEvent,
  type WheelEvent
} from "react"
import { createElement } from "react"
import { createRoot } from "react-dom/client"

import {
  connectCanvasLiveRefresh,
  Crit,
  DEFAULT_CANVAS_CAMERA_OPTIONS,
  DEFAULT_FRAME_CHROME_SETTINGS,
  type CanvasLiveRefreshEndpoint,
  type CanvasSession,
  type CritProps
} from "../../src/react/index.js"
import {
  featuresForPlaygroundProfile,
  PLAYGROUND_PROFILE_STORAGE_KEY,
  PLAYGROUND_PROFILES,
  playgroundProfileCookie,
  resolvePlaygroundProfile,
  type PlaygroundProfile
} from "./playground-profile.js"

import "./editor-shell.css"

declare const __CRIT_PLAYGROUND_DEFAULT_PROFILE__: PlaygroundProfile
declare const __CRIT_RELEASE_ENTRY__: string
declare const __CRIT_PLAYGROUND_FRAME_LOADING__: "navigate" | "relay"

const PROFILE_COPY = {
  development: { label: "Development", detail: "Comments on" },
  alpha: { label: "Alpha", detail: "Comments hidden" },
  release: { label: "Release", detail: "Packed editor" }
} as const

const readStoredProfile = () => {
  try {
    return window.localStorage.getItem(PLAYGROUND_PROFILE_STORAGE_KEY)
  } catch {
    return null
  }
}

const initialPlaygroundProfile = () => resolvePlaygroundProfile({
  url: new URLSearchParams(window.location.search).get("profile"),
  cookie: document.cookie,
  stored: readStoredProfile(),
  fallback: __CRIT_PLAYGROUND_DEFAULT_PROFILE__
})

const persistPlaygroundProfile = (profile: PlaygroundProfile) => {
  document.cookie = playgroundProfileCookie(profile)
  try {
    window.localStorage.setItem(PLAYGROUND_PROFILE_STORAGE_KEY, profile)
  } catch {
    // Private mode can reject localStorage writes.
  }
  const url = new URL(window.location.href)
  url.searchParams.set("profile", profile)
  window.history.replaceState(null, "", url)
}

const canvasId = document.body.dataset.critCanvasId || "default"
const canvasChoices = (() => {
  try {
    const parsed = JSON.parse(document.body.dataset.critCanvasChoices || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
})()
const editorPath = document.body.dataset.critEditorPath || "/crit"
const selectCanvas = (nextCanvasId: string) => {
  if (nextCanvasId === canvasId) return
  window.location.assign(
    `${editorPath}/${encodeURIComponent(nextCanvasId)}`
  )
}
const liveRefreshEndpoint = ((): CanvasLiveRefreshEndpoint => {
  try {
    return JSON.parse(document.body.dataset.critLiveRefresh || "{}")
  } catch {
    return { enabled: false }
  }
})()
const frameLoading = { strategy: __CRIT_PLAYGROUND_FRAME_LOADING__ }
let disposeLiveRefresh: ReturnType<typeof connectCanvasLiveRefresh> | undefined
const attachLiveRefresh = (session: CanvasSession) => {
  disposeLiveRefresh?.()
  disposeLiveRefresh = connectCanvasLiveRefresh({
    canvasId,
    session,
    endpoint: liveRefreshEndpoint
  })
}

const ReleaseCrit: LazyExoticComponent<ComponentType<CritProps>> = lazy(
  async () => {
    const loaded = await import(
      /* @vite-ignore */ `/@fs${__CRIT_RELEASE_ENTRY__}`
    )
    // SAFETY: Vite serves the compiled Crit package entry as ESM with a Crit export.
    const editor = (loaded as { Crit?: ComponentType<CritProps> }).Crit
    if (editor === undefined) {
      throw new Error("Release Crit export is missing")
    }
    return { default: editor }
  }
)

function PlaygroundProfileSelector({
  profile,
  onChange
}: {
  readonly profile: PlaygroundProfile
  readonly onChange: (profile: PlaygroundProfile) => void
}) {
  const stopPointer = (event: PointerEvent) => event.stopPropagation()
  const stopWheel = (event: WheelEvent) => event.stopPropagation()
  return (
    <aside
      aria-label="Playground version"
      className="playground-profile"
      onPointerDown={stopPointer}
      onWheel={stopWheel}
    >
      <header>
        <strong>Playground</strong>
        <span>{PROFILE_COPY[profile].detail}</span>
      </header>
      <fieldset
        aria-label="Editor version"
        className="playground-profile__options"
      >
        {PLAYGROUND_PROFILES.map((option) => (
          <label key={option}>
            <input
              checked={profile === option}
              name="playground-profile"
              onChange={() => onChange(option)}
              type="radio"
              value={option}
            />
            {PROFILE_COPY[option].label}
          </label>
        ))}
      </fieldset>
    </aside>
  )
}

function PlaygroundEditor() {
  const [profile, setProfile] = useState(initialPlaygroundProfile)
  const features = featuresForPlaygroundProfile(profile)
  const Editor = profile === "release" ? ReleaseCrit : Crit

  useEffect(() => {
    persistPlaygroundProfile(profile)
  }, [profile])

  return (
    <>
      <PlaygroundProfileSelector
        profile={profile}
        onChange={setProfile}
      />
      <Suspense fallback={null}>
        <Editor
          cameraOptions={DEFAULT_CANVAS_CAMERA_OPTIONS}
          canvasChoices={canvasChoices}
          canvasId={canvasId}
          developerTools={profile !== "release"}
          features={features}
          frameChrome={DEFAULT_FRAME_CHROME_SETTINGS}
          frameLoading={frameLoading}
          key={profile}
          onCanvasSelect={selectCanvas}
          onSession={attachLiveRefresh}
        />
      </Suspense>
    </>
  )
}

createRoot(document.getElementById("crit-root")!).render(
  createElement(PlaygroundEditor)
)
