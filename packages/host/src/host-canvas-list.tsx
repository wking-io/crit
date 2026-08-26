import type { CanvasListing } from "@crit/replica/http"
import { type ReactElement } from "react"

import { canvasIndexHref } from "./host-canvas-id.js"

export function HostCanvasList({ fragment, listings }: {
  readonly fragment: string
  readonly listings: ReadonlyArray<CanvasListing>
}): ReactElement {
  if (listings.length === 0) return <p>No canvases yet.</p>
  return (
    <ul>
      {listings.map((listing) => (
        <li key={listing.canvasId}>
          <a href={canvasIndexHref(listing.canvasId, fragment)}>{listing.title}</a>
        </li>
      ))}
    </ul>
  )
}
