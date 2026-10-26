import type { Terminal } from "@xterm/xterm";

/** Adapt Android touch gestures to xterm's local history or remote mouse mode. */
export function attachTerminalTouchScroll(terminal: Terminal): () => void {
  const element = terminal.element!;
  const screen = element.querySelector<HTMLElement>(".xterm-screen")!;
  let touchId: number | null = null;
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let lastTime = 0;
  let dragging = false;
  let remainder = 0;
  let velocity = 0;
  let frame: number | null = null;

  const stopMomentum = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  const isLocalHistory = () => terminal.buffer.active.type === "normal"
    && terminal.modes.mouseTrackingMode === "none";
  const scroll = (pixels: number, clientX: number, clientY: number) => {
    const lineHeight = screen.getBoundingClientRect().height / terminal.rows;
    if (lineHeight <= 0) return;
    remainder += pixels / lineHeight;
    const lines = Math.trunc(remainder);
    remainder -= lines;
    if (lines === 0) return;
    if (isLocalHistory()) {
      terminal.scrollLines(lines);
    } else {
      // Use xterm's existing mouse protocol and alternate-screen handling.
      // Remote mouse reports represent one wheel step per event.
      for (let index = 0; index < Math.min(Math.abs(lines), terminal.rows); index++) {
        screen.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          deltaMode: WheelEvent.DOM_DELTA_LINE,
          deltaY: Math.sign(lines),
        }));
      }
    }
  };
  const cancelGesture = () => {
    touchId = null;
    dragging = false;
    stopMomentum();
  };
  const onStart = (event: TouchEvent) => {
    cancelGesture();
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchId = touch.identifier;
    startX = touch.clientX;
    startY = lastY = touch.clientY;
    lastTime = performance.now();
    velocity = remainder = 0;
  };
  const onMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      cancelGesture();
      return;
    }
    const touch = event.touches[0];
    if (touch.identifier !== touchId) return;
    if (!dragging) {
      const distance = Math.abs(touch.clientY - startY);
      if (distance < 8 || distance < Math.abs(touch.clientX - startX)) return;
      dragging = true;
    }
    event.preventDefault();
    event.stopPropagation();
    const now = performance.now();
    const delta = lastY - touch.clientY;
    velocity = Math.max(-2.5, Math.min(2.5, delta / Math.max(1, now - lastTime)));
    scroll(delta, touch.clientX, touch.clientY);
    lastY = touch.clientY;
    lastTime = now;
  };
  const onEnd = (event: TouchEvent) => {
    if (touchId === null) return;
    touchId = null;
    if (!dragging) return;
    dragging = false;
    // Suppress the compatibility click so a scroll does not open the keyboard.
    event.preventDefault();
    event.stopPropagation();
    if (!isLocalHistory() || performance.now() - lastTime > 100) return;
    let previousTime = performance.now();
    const tick = (now: number) => {
      frame = null;
      if (!element.isConnected || element.getClientRects().length === 0
        || document.visibilityState !== "visible" || !isLocalHistory()) return;
      const elapsed = Math.min(now - previousTime, 32);
      previousTime = now;
      scroll(velocity * elapsed, startX, lastY);
      velocity *= Math.exp(-elapsed / 180);
      const buffer = terminal.buffer.active;
      if (Math.abs(velocity) < 0.02
        || velocity < 0 && buffer.viewportY === 0
        || velocity > 0 && buffer.viewportY === buffer.baseY) return;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };

  screen.addEventListener("touchstart", onStart, { passive: true });
  screen.addEventListener("touchmove", onMove, { passive: false });
  screen.addEventListener("touchend", onEnd, { passive: false });
  screen.addEventListener("touchcancel", cancelGesture);
  window.addEventListener("blur", cancelGesture);
  return () => {
    cancelGesture();
    screen.removeEventListener("touchstart", onStart);
    screen.removeEventListener("touchmove", onMove);
    screen.removeEventListener("touchend", onEnd);
    screen.removeEventListener("touchcancel", cancelGesture);
    window.removeEventListener("blur", cancelGesture);
  };
}
