import { LocalBrowserConnection } from "@crit/client"

export const hostConnectionFromFragment = (fragment: string) =>
  LocalBrowserConnection.decode(fragment)
