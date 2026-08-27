export const relayIframeContextMenu = (
  event: MouseEvent,
  iframe: HTMLIFrameElement,
  frame: HTMLElement
) => {
  event.preventDefault()
  event.stopPropagation()
  const rect = iframe.getBoundingClientRect()
  frame.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    button: 2,
    buttons: 2,
    cancelable: true,
    clientX: rect.left + event.clientX,
    clientY: rect.top + event.clientY,
    view: window
  }))
}

export const connectIframeContextMenu = (iframe: HTMLIFrameElement) => {
  let disconnectInner = () => {}
  const bindInner = () => {
    disconnectInner()
    try {
      const iframeWindow = iframe.contentWindow
      if (iframeWindow === null) return
      const openContextMenu = (event: MouseEvent) => {
        const frame = iframe.closest(".crit-frame")
        if (!(frame instanceof HTMLElement)) return
        relayIframeContextMenu(event, iframe, frame)
      }
      iframeWindow.addEventListener("contextmenu", openContextMenu, true)
      disconnectInner = () => {
        try {
          iframeWindow.removeEventListener("contextmenu", openContextMenu, true)
        } catch {
          return
        }
      }
    } catch {
      disconnectInner = () => {}
    }
  }
  iframe.addEventListener("load", bindInner)
  bindInner()
  return () => {
    iframe.removeEventListener("load", bindInner)
    disconnectInner()
  }
}
