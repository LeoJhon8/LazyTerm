import { useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { CheckCircle, XCircle, Info, X, File } from "lucide-react";

type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  text: string;
  type: ToastType;
  files?: string[]; // 可选的文件列表
}

// 全局 toast 状态管理
let toastIdCounter = 0;
const toastListeners = new Set<() => void>();
let globalToasts: ToastMessage[] = [];

function addToast(text: string, type: ToastType = 'info', files?: string[]) {
  const id = ++toastIdCounter;
  globalToasts = [...globalToasts, { id, text, type, files }];
  toastListeners.forEach(listener => listener());
}

function removeToast(id: number) {
  globalToasts = globalToasts.filter(t => t.id !== id);
  toastListeners.forEach(listener => listener());
}

function subscribeToToasts(listener: () => void) {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
}

function getToastSnapshot() {
  return globalToasts;
}

// 导出全局方法
export const toast = {
  success: (text: string, files?: string[]) => addToast(text, 'success', files),
  error: (text: string) => addToast(text, 'error'),
  info: (text: string) => addToast(text, 'info'),
};

// Toast 图标映射
const toastConfig = {
  success: {
    icon: CheckCircle,
    className: "border-green-500/30 bg-green-500/10 text-green-400",
  },
  error: {
    icon: XCircle,
    className: "border-red-500/30 bg-red-500/10 text-red-400",
  },
  info: {
    icon: Info,
    className: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  },
};

export function ToastContainer() {
  const toasts = useSyncExternalStore(
    subscribeToToasts,
    getToastSnapshot,
    getToastSnapshot,
  );

  const handleClose = useCallback((id: number) => {
    removeToast(id);
  }, []);

  if (toasts.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex max-w-sm flex-col gap-2">
      {toasts.map((toast) => {
        const config = toastConfig[toast.type];
        const Icon = config.icon;

        return (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex flex-col gap-2 border px-4 py-3 shadow-2xl backdrop-blur-xl",
              "animate-in slide-in-from-right duration-300",
              "rounded-md", // 改为小圆角
              config.className
            )}
          >
            <div className="flex items-center gap-3">
              <Icon className="h-5 w-5 shrink-0" />
              <span className="flex-1 text-sm font-medium">{toast.text}</span>
              <button
                type="button"
                onClick={() => handleClose(toast.id)}
                className="shrink-0 rounded p-0.5 transition-colors hover:bg-white/10"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            
            {/* 文件列表 */}
            {toast.files && toast.files.length > 0 && (
              <div className="ml-8 flex flex-col gap-1 max-h-32 overflow-y-auto">
                {toast.files.map((file, index) => (
                  <div key={index} className="flex items-center gap-2 text-xs opacity-80">
                    <File className="h-3 w-3 shrink-0" />
                    <span className="truncate">{file}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
