import { Schema } from "effect"

const TestServerAddress = Schema.Struct({ port: Schema.Number })
const decodeTestServerAddress = Schema.decodeUnknownSync(TestServerAddress)

export const serverPort = (server: {
  readonly address: () => string | { readonly port: number } | null
}): number => {
  const address = decodeTestServerAddress(server.address())
  return address.port
}
