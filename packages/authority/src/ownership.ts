declare const structuredClone: <A>(value: A) => A

export const detach = <A>(value: A): A => structuredClone(value)
