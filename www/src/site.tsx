import { BrowserCritClient, Crit } from "@riff-refine/crit"
import { useMemo, useState } from "react"

import { readLaunchAuthor, writeLaunchAuthor } from "./author.js"
import { launchSeedDocument } from "./document.js"
import { LAUNCH_CANVAS_ID, LAUNCH_FOCUS_ITEM_ID } from "./layout.js"

export function LaunchSite() {
  const [author, setAuthor] = useState(readLaunchAuthor)
  const seed = useMemo(launchSeedDocument, [])
  const services = useMemo(
    () =>
      BrowserCritClient.make({
        author,
        databaseName: "@riff-refine/crit/www",
        seed: [seed]
      }),
    [author, seed]
  )
  return (
    <div className="launch-root">
      <Crit
        canvasId={LAUNCH_CANVAS_ID}
        focusItemId={LAUNCH_FOCUS_ITEM_ID}
        onSignIn={(next) => {
          writeLaunchAuthor(next)
          setAuthor(next)
        }}
        services={services}
      />
    </div>
  )
}
