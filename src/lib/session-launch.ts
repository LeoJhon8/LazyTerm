import { usePanesStore } from "@/store/panes";
import { useTabsStore, type TerminalSession } from "@/store/tabs";

export type NewTerminalSession = Omit<TerminalSession, "id" | "connector" | "connectionStatus">;

function getReplaceableLocalSession(): { tabId: string; paneId: string; oldSessionId: string } | null {
  const tabsStore = useTabsStore.getState();
  const panesStore = usePanesStore.getState();
  const currentTabId = tabsStore.activeTabId;
  if (!currentTabId) return null;

  const workspace = panesStore.getWorkspace(currentTabId);
  if (!workspace.rootNode) return null;

  const leaves = panesStore.getAllLeaves(currentTabId);
  if (leaves.length !== 1) return null;

  const soleLeaf = leaves[0];
  if (!soleLeaf.sessionId) return null;

  const session = tabsStore.sessions.find((item) => item.id === soleLeaf.sessionId);
  if (!session || session.type !== "local") return null;

  return { tabId: currentTabId, paneId: soleLeaf.id, oldSessionId: soleLeaf.sessionId };
}

export function launchWorkspaceWithSession(sessionData: NewTerminalSession) {
  const tabsStore = useTabsStore.getState();
  const panesStore = usePanesStore.getState();
  const replaceTarget = getReplaceableLocalSession();

  if (replaceTarget) {
    tabsStore.removeSession(replaceTarget.oldSessionId);
    const sessionId = tabsStore.addSession(sessionData);
    panesStore.setPaneSession(replaceTarget.paneId, sessionId);
    tabsStore.updateTab(replaceTarget.tabId, { title: sessionData.title });
    return;
  }

  const tabId = tabsStore.addTab({ title: sessionData.title });
  tabsStore.setActiveTabId(tabId);
  const sessionId = tabsStore.addSession(sessionData);
  panesStore.addPane(sessionId);
}
