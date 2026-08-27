import type { CanvasCommandBatch, CanvasProjection } from "@crit/domain"
import { type ReactElement } from "react"

import { useLiveCanvasSelection } from "./canvas-selection-store.js"
import { GlyphProvider } from "./glyph.js"
import { CritOverlayProvider, useCritOverlayContainer } from "./overlay-container.js"
import { ReviewSelection, type ReviewClientEffect } from "./review-actions.js"
import { ReviewChromeView } from "./review-chrome-view.js"
import {
  ReviewRunnerProvider,
  useOptionalReviewRunner
} from "./review-runner.js"
import type { FrameSnapshotter } from "./frame-snapshot.js"

export interface ReviewChromeProps {
  readonly projection: CanvasProjection
  readonly selection: ReviewSelection
  readonly onSubmit: (commands: CanvasCommandBatch) => void
  readonly onEffect?: (effect: ReviewClientEffect) => void
  readonly snapshotter?: FrameSnapshotter
  readonly fullscreen?: boolean
  readonly onAddFramePlacement?:
    | (() => { readonly x: number; readonly y: number })
    | undefined
}

export function ReviewChrome(props: ReviewChromeProps): ReactElement {
  const overlay = useCritOverlayContainer()
  const runner = useOptionalReviewRunner()
  const liveItems = useLiveCanvasSelection(props.selection.items)
  const liveSelection = ReviewSelection.items({ items: liveItems })
  const view = runner === null
    ? (
      <ReviewRunnerProvider
        fullscreen={props.fullscreen ?? false}
        getSelection={() => ReviewSelection.items({ items: liveItems })}
        onEffect={props.onEffect}
        onSubmit={props.onSubmit}
        projection={props.projection}
        selection={liveSelection}
        snapshotter={props.snapshotter}
      >
        <ReviewChrome {...props} />
      </ReviewRunnerProvider>
    )
    : (
      <ReviewChromeView
        onAddFramePlacement={props.onAddFramePlacement}
        projection={props.projection}
        requestAddFrame={runner.requestAddFrame}
        run={runner.run}
        runnableIds={runner.runnableIds()}
        snapshotCapturing={runner.snapshotCapturing}
        snapshotFailed={runner.snapshotFailed}
      />
    )
  if (overlay !== undefined) return view
  return (
    <GlyphProvider>
      <CritOverlayProvider>
        {view}
      </CritOverlayProvider>
    </GlyphProvider>
  )
}
