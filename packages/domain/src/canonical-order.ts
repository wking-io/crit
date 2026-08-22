export const compareCanonicalId = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

export const isCanonicalIdOrder = (values: readonly string[]): boolean =>
  values.every((value, index) => index === 0 || compareCanonicalId(values[index - 1]!, value) < 0)
