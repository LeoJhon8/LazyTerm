import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { registerAndroidBackHandler } from "@/lib/android-back";
import { IS_ANDROID } from "@/lib/platform";

export function useAndroidBackHandler(
  active: boolean,
  handler: () => boolean,
  priority: number,
) {
  const handlerRef = useRef(handler);

  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useLayoutEffect(() => {
    if (!IS_ANDROID || !active) return;
    return registerAndroidBackHandler(() => handlerRef.current(), priority);
  }, [active, priority]);
}

interface AndroidDismissibleLayerOptions {
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  priority: number;
}

export function useAndroidDismissibleLayer({
  defaultOpen = false,
  onOpenChange,
  open,
  priority,
}: AndroidDismissibleLayerOptions) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const resolvedOpen = open ?? uncontrolledOpen;

  const setOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange, open]);

  useAndroidBackHandler(resolvedOpen, () => {
    setOpen(false);
    return true;
  }, priority);

  return [resolvedOpen, setOpen] as const;
}
