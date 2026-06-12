import type { RDPConfig, SSHConfig, VNCConfig } from "@/types/terminal";
import { secureConnectionConfig } from "@/store/credentials";
import { useSshProfilesStore } from "@/store/ssh-profiles";
import { logger } from "@/lib/logger";

let migrationPromise: Promise<void> | null = null;

export function migrateProfileCredentials(): Promise<void> {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const store = useSshProfilesStore.getState();
    for (const node of store.nodes) {
      if (!node.config || !["ssh", "rdp", "vnc"].includes(node.type)) continue;
      const config = node.config as SSHConfig | RDPConfig | VNCConfig;
      const hasSecret = "password" in config && Boolean(config.password)
        || "privateKey" in config && Boolean(config.privateKey)
        || "privateKeyPassphrase" in config && Boolean(config.privateKeyPassphrase);
      if (!hasSecret) continue;
      try {
        const secured = await secureConnectionConfig(node.type as "ssh" | "rdp" | "vnc", config);
        store.updateNode(node.id, { config: secured });
        logger.info("FE/migration/credentials", `已迁移会话凭据: ${node.name}`);
      } catch (error) {
        logger.error("FE/migration/credentials", `迁移会话凭据失败: ${node.name}`, { error });
      }
    }
  })().finally(() => {
    migrationPromise = null;
  });
  return migrationPromise;
}
