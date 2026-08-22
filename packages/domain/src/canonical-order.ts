import { Order } from "effect"

export const compareCanonicalId: Order.Order<string> = Order.String

export const isCanonicalIdOrder = (values: readonly string[]): boolean =>
  values.every((value, index) => index === 0 || compareCanonicalId(values[index - 1]!, value) < 0)
