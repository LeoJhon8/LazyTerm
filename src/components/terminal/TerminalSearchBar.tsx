import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, WholeWord, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export interface TerminalSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

interface TerminalSearchBarProps {
  focusRequest: number;
  query: string;
  resultIndex: number;
  resultCount: number;
  invalidRegex: boolean;
  options: TerminalSearchOptions;
  onQueryChange: (query: string) => void;
  onOptionsChange: (options: TerminalSearchOptions) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function TerminalSearchBar({
  focusRequest,
  query,
  resultIndex,
  resultCount,
  invalidRegex,
  options,
  onQueryChange,
  onOptionsChange,
  onPrevious,
  onNext,
  onClose,
}: TerminalSearchBarProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();

    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        onPrevious();
      } else {
        onNext();
      }
      return;
    }

    if (event.key.toLowerCase() === "f" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      inputRef.current?.select();
    }
  };

  const keepInputFocused = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  let resultLabel = "";
  if (invalidRegex) {
    resultLabel = t("无效正则");
  } else if (query && resultCount === 0) {
    resultLabel = t("无匹配结果");
  } else if (resultIndex >= 0) {
    resultLabel = `${resultIndex + 1} / ${resultCount}`;
  } else if (query) {
    resultLabel = `${resultCount}`;
  }

  const toggleOption = (key: keyof TerminalSearchOptions) => {
    onOptionsChange({
      ...options,
      [key]: !options[key],
    });
  };

  return (
    <div
      className="absolute right-2 top-2 z-110 flex h-9 w-[420px] max-w-[calc(100%_-_1rem)] items-center gap-1 overflow-hidden rounded-xl border border-border/70 bg-popover/96 px-1.5 text-popover-foreground shadow-xl backdrop-blur-xl"
      role="search"
      aria-label={t("查找终端内容")}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("在终端中查找")}
        aria-label={t("在终端中查找")}
        autoComplete="off"
        spellCheck={false}
        className="h-7 min-w-20 flex-1 bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground/70"
      />

      <span
        className={cn(
          "min-w-11 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground",
          query && (invalidRegex || resultCount === 0) && "text-destructive"
        )}
        aria-live="polite"
      >
        {resultLabel}
      </span>

      <SearchOptionButton
        active={options.caseSensitive}
        label={t("区分大小写")}
        onMouseDown={keepInputFocused}
        onClick={() => toggleOption("caseSensitive")}
      >
        <CaseSensitive />
      </SearchOptionButton>
      <SearchOptionButton
        active={options.wholeWord}
        label={t("全词匹配")}
        onMouseDown={keepInputFocused}
        onClick={() => toggleOption("wholeWord")}
      >
        <WholeWord />
      </SearchOptionButton>
      <SearchOptionButton
        active={options.regex}
        label={t("使用正则表达式")}
        onMouseDown={keepInputFocused}
        onClick={() => toggleOption("regex")}
      >
        <Regex />
      </SearchOptionButton>

      <Button
        type="button"
        variant="ghost"
        className="h-7 w-7 shrink-0 rounded-lg p-0"
        onMouseDown={keepInputFocused}
        onClick={onPrevious}
        disabled={!query}
        aria-label={t("上一个匹配项")}
        title={t("上一个匹配项")}
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="h-7 w-7 shrink-0 rounded-lg p-0"
        onMouseDown={keepInputFocused}
        onClick={onNext}
        disabled={!query}
        aria-label={t("下一个匹配项")}
        title={t("下一个匹配项")}
      >
        <ChevronDown />
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="h-7 w-7 shrink-0 rounded-lg p-0"
        onMouseDown={keepInputFocused}
        onClick={onClose}
        aria-label={t("关闭搜索")}
        title={t("关闭搜索")}
      >
        <X />
      </Button>
    </div>
  );
}

function SearchOptionButton({
  active,
  label,
  children,
  onMouseDown,
  onClick,
}: {
  active: boolean;
  label: string;
  children: ReactNode;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "h-7 w-7 shrink-0 rounded-lg p-0",
        active && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
      )}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
