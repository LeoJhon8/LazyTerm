import { useEffect, useState } from "react";

/** 位于滚动视口外，不拦截操作，也不改变可滚动区域的尺寸。 */
export function ScrollEdgeHints({ viewport }: { viewport: HTMLElement | null }) {
  const [edges, setEdges] = useState({ top: false, bottom: false });

  useEffect(() => {
    if (!viewport) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = viewport.scrollTop > 1;
      const bottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 1;
      setEdges((previous) => previous.top === top && previous.bottom === bottom
        ? previous : { top, bottom });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resizeObserver = new ResizeObserver(schedule);
    const observeContent = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(viewport);
      for (const child of viewport.children) resizeObserver.observe(child);
      schedule();
    };
    const mutationObserver = new MutationObserver(observeContent);
    mutationObserver.observe(viewport, { childList: true, subtree: true, characterData: true });
    viewport.addEventListener("scroll", schedule, { passive: true });
    observeContent();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      viewport.removeEventListener("scroll", schedule);
    };
  }, [viewport]);

  return (
    <div className="scroll-edge-hints" aria-hidden="true">
      <span className="scroll-edge-hint scroll-edge-hint-top" data-visible={edges.top} />
      <span className="scroll-edge-hint scroll-edge-hint-bottom" data-visible={edges.bottom} />
    </div>
  );
}
