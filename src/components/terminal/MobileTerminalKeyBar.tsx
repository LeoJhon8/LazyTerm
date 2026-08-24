import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { PencilLine } from "lucide-react";

import { useI18n } from "@/i18n";
import {
  resolveMobileTerminalKeyDefinition,
  type MobileTerminalKeyDefinition,
} from "@/lib/mobile-terminal-keys";
import { useSettingsStore } from "@/store/settings";

const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 80;

function MobileTerminalKeyButton({
  definition,
  disabled,
  onSend,
}: {
  definition: MobileTerminalKeyDefinition;
  disabled: boolean;
  onSend: (data: string) => void;
}) {
  const { t } = useI18n();
  const [pressed, setPressed] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const activePointerIdRef = useRef<number | null>(null);
  const repeatDelayRef = useRef<number | null>(null);
  const repeatIntervalRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  const stopRepeating = useCallback(() => {
    if (repeatDelayRef.current !== null) {
      window.clearTimeout(repeatDelayRef.current);
      repeatDelayRef.current = null;
    }
    if (repeatIntervalRef.current !== null) {
      window.clearInterval(repeatIntervalRef.current);
      repeatIntervalRef.current = null;
    }
    activePointerIdRef.current = null;
    setPressed(false);
    setRepeating(false);

    if (suppressClickRef.current) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }, []);

  useEffect(() => stopRepeating, [stopRepeating]);

  useEffect(() => {
    if (disabled) stopRepeating();
  }, [disabled, stopRepeating]);

  useEffect(() => {
    const handleWindowBlur = () => stopRepeating();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") stopRepeating();
    };

    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [stopRepeating]);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0 || activePointerIdRef.current !== null) return;
    activePointerIdRef.current = event.pointerId;
    setPressed(true);

    if (!definition.repeatable) return;
    repeatDelayRef.current = window.setTimeout(() => {
      repeatDelayRef.current = null;
      suppressClickRef.current = true;
      setRepeating(true);
      onSend(definition.data);
      repeatIntervalRef.current = window.setInterval(() => {
        onSend(definition.data);
      }, REPEAT_INTERVAL_MS);
    }, REPEAT_DELAY_MS);
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const isOutside = event.clientX < bounds.left
      || event.clientX > bounds.right
      || event.clientY < bounds.top
      || event.clientY > bounds.bottom;
    if (!isOutside) return;
    stopRepeating();
  };

  const handlePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    stopRepeating();
  };

  const handleClick = () => {
    if (disabled) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSend(definition.data);
  };

  return (
    <button
      type="button"
      className="mobile-terminal-key-button"
      data-active={pressed || undefined}
      data-repeating={repeating || undefined}
      data-width={definition.width}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={stopRepeating}
      onClick={handleClick}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={definition.repeatable
        ? t("{key}，长按可连续发送", { key: definition.label })
        : definition.label}
    >
      {definition.label}
    </button>
  );
}

export function MobileTerminalKeyBar({
  disabled,
  onEdit,
  onSend,
}: {
  disabled: boolean;
  onEdit: () => void;
  onSend: (data: string) => void;
}) {
  const { t } = useI18n();
  const terminalKeys = useSettingsStore((state) => state.mobileTerminalKeys);

  return (
    <div className="mobile-terminal-keys" aria-label={t("发送常用按键")}>
      <div className="mobile-terminal-keys-scroll">
        {terminalKeys.map((item) => {
          const definition = resolveMobileTerminalKeyDefinition(item);
          return (
            <MobileTerminalKeyButton
              key={definition.id}
              definition={definition}
              disabled={disabled}
              onSend={onSend}
            />
          );
        })}
        {terminalKeys.length === 0 && (
          <span className="mobile-terminal-keys-empty">{t("点击编辑添加按键")}</span>
        )}
      </div>
      <button
        type="button"
        className="mobile-terminal-keys-edit"
        onClick={onEdit}
        aria-label={t("编辑终端快捷栏")}
        title={t("编辑终端快捷栏")}
      >
        <PencilLine className="h-4 w-4" />
      </button>
    </div>
  );
}
