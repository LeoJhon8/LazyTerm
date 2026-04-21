import { Terminal, Server, Monitor, Cpu, Keyboard, Usb } from "lucide-react";
import { useI18n } from "@/i18n";
import { useTabsStore } from "@/store/tabs";
import { usePanesStore } from "@/store/panes";
import { useSettingsStore } from "@/store/settings";
import { getAvailableShells } from "@/services/shellService";
import { emitQuickConnect } from "@/lib/quick-connect-event";
import logo128 from "../../../src-tauri/icons/LazyTerm-128.png";

/**
 * 品牌化欢迎页 — 替代原始的纯文字空状态
 * 利用项目已有的 terminal-empty-state / terminal-empty-card 样式体系
 */
export function WelcomePage() {
  const { t } = useI18n();
  const { addTab, addSession } = useTabsStore();
  const { addPane } = usePanesStore();

  /** 打开本地终端（使用用户配置的默认 Shell，标题与 TabBar 一致） */
  const handleOpenLocalTerminal = async () => {
    const defaultShell = useSettingsStore.getState().defaultShell;
    let title = t("终端");
    try {
      const shells = await getAvailableShells();
      const shellInfo = shells.find(
        (s) => s.path === defaultShell || s.name.toLowerCase() === defaultShell.toLowerCase()
      );
      if (shellInfo) {
        title = shellInfo.name;
      } else if (defaultShell.includes("powershell")) {
        title = "PowerShell";
      } else if (defaultShell.includes("cmd")) {
        title = "CMD";
      }
    } catch { /* 降级使用默认标题 */ }

    const tabId = addTab({ title });
    const sessionId = addSession({ title, type: "local", config: { shell: defaultShell, admin: false } });
    addPane(sessionId);
    useTabsStore.getState().setActiveTabId(tabId);
  };

  return (
    <div className="terminal-empty-state">
      {/* 背景装饰动画 */}
      <div className="welcome-bg-rings" aria-hidden="true">
        <div className="welcome-ring welcome-ring-1" />
        <div className="welcome-ring welcome-ring-2" />
        <div className="welcome-ring welcome-ring-3" />
      </div>

      <div className="terminal-empty-card welcome-card">
        {/* 品牌 Logo */}
        <div className="welcome-logo-area">
          <div className="welcome-logo-glow" aria-hidden="true" />
          <img
            src={logo128}
            alt="LazyTerm"
            className="welcome-logo"
            draggable={false}
          />
        </div>

        {/* 标题区 */}
        <div className="welcome-heading">
          <h1 className="welcome-title">{t("欢迎使用 LazyTerm")}</h1>
          <p className="welcome-subtitle">
            {t("轻松、快速建立 SSH、远程桌面、VNC、串口、Telnet 连接，或打开本地终端")}
          </p>
        </div>

        {/* 快捷操作卡片 */}
        <div className="welcome-actions">
          <button className="welcome-action-card" onClick={handleOpenLocalTerminal}>
            <div className="welcome-action-icon welcome-action-icon--terminal">
              <Terminal className="h-5 w-5" />
            </div>
            <div className="welcome-action-text">
              <span className="welcome-action-label">{t("本地终端")}</span>
              <span className="welcome-action-desc">{t("打开命令行")}</span>
            </div>
          </button>

          <button className="welcome-action-card" onClick={() => emitQuickConnect("ssh")}>
            <div className="welcome-action-icon welcome-action-icon--ssh">
              <Server className="h-5 w-5" />
            </div>
            <div className="welcome-action-text">
              <span className="welcome-action-label">{t("SSH 连接")}</span>
              <span className="welcome-action-desc">{t("安全远程终端")}</span>
            </div>
          </button>

          <button className="welcome-action-card" onClick={() => emitQuickConnect("rdp")}>
            <div className="welcome-action-icon welcome-action-icon--rdp">
              <Monitor className="h-5 w-5" />
            </div>
            <div className="welcome-action-text">
              <span className="welcome-action-label">{t("远程桌面")}</span>
              <span className="welcome-action-desc">{t("Windows RDP")}</span>
            </div>
          </button>

          <button className="welcome-action-card" onClick={() => emitQuickConnect("vnc")}>
            <div className="welcome-action-icon welcome-action-icon--vnc">
              <Cpu className="h-5 w-5" />
            </div>
            <div className="welcome-action-text">
              <span className="welcome-action-label">{t("VNC 连接")}</span>
              <span className="welcome-action-desc">{t("跨平台远程")}</span>
            </div>
          </button>

          <button className="welcome-action-card" onClick={() => emitQuickConnect("serial")}>
            <div className="welcome-action-icon welcome-action-icon--serial">
              <Usb className="h-5 w-5" />
            </div>
            <div className="welcome-action-text">
              <span className="welcome-action-label">{t("串口连接")}</span>
              <span className="welcome-action-desc">{t("串口通信")}</span>
            </div>
          </button>

          <button className="welcome-action-card" onClick={() => emitQuickConnect("telnet")}>
            <div className="welcome-action-icon welcome-action-icon--telnet">
              <Terminal className="h-5 w-5" />
            </div>
            <div className="welcome-action-text">
              <span className="welcome-action-label">{t("Telnet 连接")}</span>
              <span className="welcome-action-desc">{t("远程终端协议")}</span>
            </div>
          </button>
        </div>

        {/* 底部提示 */}
        <div className="welcome-hint">
          <Keyboard className="h-3.5 w-3.5" />
          <span>{t("点击左侧会话面板创建和管理连接")}</span>
        </div>
      </div>
    </div>
  );
}
