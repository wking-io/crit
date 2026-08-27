import type { CanvasListing } from "@crit/replica/http"
import { Link } from "@tanstack/react-router"
import { type ReactElement } from "react"

export function HostCanvasList({ listings, sessionHash }: {
  readonly listings: ReadonlyArray<CanvasListing>
  readonly sessionHash?: string
}): ReactElement {
  if (listings.length === 0) return <p>No canvases yet.</p>
  return (
    <ul>
      {listings.map((listing) => (
        <li key={listing.canvasId}>
          <Link
            {...(sessionHash === undefined ? {} : { hash: sessionHash })}
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
