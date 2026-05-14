import { Plus, Zap } from "lucide-react";
import { useI18n } from "@/i18n";
import { emitNewConnection, emitQuickConnect } from "@/lib/quick-connect-event";
import logo128 from "../../../src-tauri/icons/LazyTerm-128.png";

/**
 * Branded welcome page.
 * Entry actions are routed through SessionModule so dialogs stay centralized.
 */
export function WelcomePage() {
  const { t } = useI18n();

  return (
    <div className="terminal-empty-state">
      <div className="welcome-bg-rings" aria-hidden="true">
        <div className="welcome-ring welcome-ring-1" />
        <div className="welcome-ring welcome-ring-2" />
        <div className="welcome-ring welcome-ring-3" />
      </div>

      <div className="terminal-empty-card welcome-card">
        <div className="welcome-logo-area">
          <div className="welcome-logo-glow" aria-hidden="true" />
          <img
            src={logo128}
            alt="LazyTerm"
            className="welcome-logo"
            draggable={false}
          />
        </div>

        <div className="welcome-heading">
          <h1 className="welcome-title">{t("欢迎使用 LazyTerm")}</h1>
        </div>

        <div className="welcome-actions">
          <button className="welcome-action-card" onClick={() => emitQuickConnect()}>
            <div className="welcome-action-icon welcome-action-icon--terminal">
              <Zap className="h-5 w-5" />
            </div>
            <div className="welcome-action-text">
              <span className="welcome-action-label">{t("快速连接")}</span>
            </div>
          </button>

          <button className="welcome-action-card" onClick={emitNewConnection}>
            <div className="welcome-action-icon welcome-action-icon--ssh">
              <Plus className="h-5 w-5" />
            </div>
            <div className="welcome-action-text">
              <span className="welcome-action-label">{t("新建连接")}</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
