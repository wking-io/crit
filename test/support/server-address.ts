export const serverPort = (server: {
  readonly address: () => string | { readonly port: number } | null
}): number => {
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new TypeError("Expected the test server to listen on an IP port")
  }
  return address.port
}
