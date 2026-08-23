declare const structuredClone: <A>(value: A) => A

export const DomainValue = {
  detach: <A>(value: A): A => structuredClone(value)
}
