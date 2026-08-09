export const hasNodeErrorCode = (cause: unknown, code: string) =>
  cause instanceof Error && "code" in cause && cause.code === code
