import { useEffect, useState } from "react";
import { NewConnectionDialog } from "@/components/dialogs/NewConnectionDialog";
import { QuickConnectDialog } from "@/components/dialogs/QuickConnectDialog";
import { useDialogState } from "@/hooks/useDialogState";
import { useI18n } from "@/i18n";
import { logger } from "@/lib/logger";
import { onNewConnection, onQuickConnect, type QuickConnectType } from "@/lib/quick-connect-event";
import { launchWorkspaceWithSession, type NewTerminalSession } from "@/lib/session-launch";
import { secureConnectionConfig } from "@/store/credentials";
import { useSshProfilesStore } from "@/store/ssh-profiles";
import type { RDPConfig, SSHConfig, VNCConfig } from "@/types/terminal";

const ROOT_FOLDER_ID = "root-folder";

export function SessionEntryDialogs() {
  const { locale } = useI18n();
  const dialog = useDialogState();
  const { addProfile, ensureRoot, syncRootFolderName } = useSshProfilesStore();
  const [initialQuickConnectType, setInitialQuickConnectType] = useState<QuickConnectType | null>(null);

  useEffect(() => {
    ensureRoot();
    syncRootFolderName();
  }, [ensureRoot, syncRootFolderName, locale]);

  useEffect(() => {
    return onQuickConnect((type) => {
      setInitialQuickConnectType(type);
      dialog.open("quickConnect");
    });
  }, [dialog]);

  useEffect(() => {
    return onNewConnection(() => {
      dialog.open("newConnection");
    });
  }, [dialog]);

  const saveRemoteProfile = async (
    type: "ssh" | "rdp" | "vnc",
    config: SSHConfig | RDPConfig | VNCConfig,
  ) => {
    try {
      const secured = await secureConnectionConfig(type, config);
      addProfile(type, secured, ROOT_FOLDER_ID);
      dialog.close();
    } catch (error) {
      logger.error("FE/session-entry/save-profile", "Failed to save remote session credentials", { error });
    }
  };

  return (
    <>
      <QuickConnectDialog
        open={dialog.isOpen("quickConnect")}
        onOpenChange={() => {
          setInitialQuickConnectType(null);
          dialog.close();
        }}
        initialType={initialQuickConnectType ?? undefined}
        onConnect={(sessionData) => {
          launchWorkspaceWithSession(sessionData as NewTerminalSession);
        }}
      />

      <NewConnectionDialog
        open={dialog.isOpen("newConnection")}
        onOpenChange={() => dialog.close()}
        onSave={(type, config) => {
          if (type === "ssh" || type === "rdp" || type === "vnc") {
            void saveRemoteProfile(type, config as SSHConfig | RDPConfig | VNCConfig);
            return;
          }

          addProfile(type, config, ROOT_FOLDER_ID);
          dialog.close();
        }}
      />
    </>
  );
}
