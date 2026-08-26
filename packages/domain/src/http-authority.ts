export const publicDnsHostnameFailure = (
  hostname: string,
  noun: string
): string | undefined => {
  if (hostname !== hostname.toLowerCase()) {
    return `${noun} hostname must be lowercase`
  }
  if (
    hostname.length > 253 ||
    hostname.endsWith(".") ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost")
  ) {
    return `${noun} must use a canonical public DNS hostname`
  }

  const labels = hostname.split(".")
  if (labels.some((label) =>
    label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )) {
    return `${noun} contains an invalid DNS label`
  }
  if (labels.every((label) => /^(?:[0-9]+|0x[0-9a-f]+)$/.test(label))) {
    return `${noun} cannot use an IP or alternate numeric host`
  }
  return undefined
}

export const canonicalHttpPortFailure = (
  scheme: string,
  port: string | undefined,
  noun: string
): string | undefined => {
  if (port === undefined) return undefined
  const portNumber = Number(port)
  if (
    port.startsWith("0") ||
    !Number.isSafeInteger(portNumber) ||
    portNumber < 1 ||
    portNumber > 65_535 ||
    (scheme === "http" && portNumber === 80) ||
    (scheme === "https" && portNumber === 443)
  ) {
    return `${noun} port must use a canonical non-default numeric form`
  }
  return undefined
}
