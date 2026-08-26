import type { CanvasListing } from "@crit/replica/http"
import { Link } from "@tanstack/react-router"
import { type ReactElement } from "react"

import { sessionHash } from "./host-canvas-id.js"

export function HostCanvasList({ fragment, listings }: {
  readonly fragment: string
  readonly listings: ReadonlyArray<CanvasListing>
}): ReactElement {
  if (listings.length === 0) return <p>No canvases yet.</p>
  return (
    <ul>
      {listings.map((listing) => (
        <li key={listing.canvasId}>
          <Link
            hash={sessionHash(fragment)}
            params={{ canvasId: listing.canvasId }}
            to="/canvas/$canvasId"
          >
            {listing.title}
          </Link>
        </li>
      ))}
    </ul>
  )
}
