import {
  Profiler,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type LazyExoticComponent
} from "react"
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import {
  installCanvasPerformanceProbe,
  recordCanvasReactCommit
} from "../../packages/react/src/canvas-performance-probe.js"

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

function PlaygroundEditor() {
  const [profile, setProfile] = useState(initialPlaygroundProfile)
  const features = featuresForPlaygroundProfile(profile)
  const Editor = profile === "release" ? ReleaseCrit : Crit

  useEffect(() => {
    persistPlaygroundProfile(profile)
  }, [profile])

  return (
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
        extraCanvasContextMenus={[{
          label: "Playground",
          description: "Choose which editor version the playground loads.",
          items: PLAYGROUND_PROFILES.map((option) => ({
            label: PROFILE_COPY[option].label,
            description: PROFILE_COPY[option].detail,
            selected: option === profile,
            onSelect: () => setProfile(option)
          }))
        }]}
        onCanvasSelect={selectCanvas}
        onSession={attachLiveRefresh}
      />
    </Suspense>
  )
}

installCanvasPerformanceProbe()
createRoot(document.getElementById("crit-root")!).render(
  <Profiler id="crit-alpha" onRender={(_id, _phase, duration) => {
    recordCanvasReactCommit(duration)
  }}>
    {createElement(PlaygroundEditor)}
  </Profiler>
)
