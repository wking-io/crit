class IntersectionObserverStub {
  disconnect() {}
  observe() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  unobserve() {}
}

export const installIntersectionObserver = (): void => {
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: IntersectionObserverStub
  })
}
