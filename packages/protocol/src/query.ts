const decodeComponent = (value: string): string => {
  try {
    return decodeURIComponent(value.replaceAll("+", " "))
  } catch {
    return value
  }
}

const encodeComponent = (value: string): string =>
  encodeURIComponent(value).replaceAll("%20", "+")

export const queryParam = (search: string, name: string): string | null => {
  const query = search.startsWith("?") ? search.slice(1) : search
  if (query.length === 0) return null
  for (const pair of query.split("&")) {
    if (pair.length === 0) continue
    const separator = pair.indexOf("=")
    const key = decodeComponent(separator === -1 ? pair : pair.slice(0, separator))
    if (key !== name) continue
    return separator === -1 ? "" : decodeComponent(pair.slice(separator + 1))
  }
  return null
}

export const encodeQuery = (
  entries: ReadonlyArray<readonly [string, string]>
): string =>
  entries
    .map(([key, value]) => `${encodeComponent(key)}=${encodeComponent(value)}`)
    .join("&")
