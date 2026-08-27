export const scheduleCritRegistryTask = (task: () => void) => {
  let cancelled = false
  queueMicrotask(() => {
    if (!cancelled) task()
  })
  return () => {
    cancelled = true
  }
}
