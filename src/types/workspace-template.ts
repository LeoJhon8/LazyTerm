import type { SplitDirection } from "@/lib/pane-utils";
import type { SessionConfig, TerminalSession } from "@/store/tabs";

export type WorkspaceTemplateSessionType = TerminalSession["type"];

export interface WorkspaceTemplateSession {
  key: string;
  title: string;
  type: WorkspaceTemplateSessionType;
  cwd?: string;
  host?: string;
  config?: SessionConfig;
}

export type WorkspaceTemplatePaneNode =
  | {
      type: "leaf";
      sessionKey: string;
      fontSize?: number;
    }
  | {
      type: "split";
      direction: SplitDirection;
      ratio: number;
      children: [WorkspaceTemplatePaneNode, WorkspaceTemplatePaneNode];
    };

export interface WorkspaceTemplateDefinition {
  sessions: WorkspaceTemplateSession[];
  rootNode: WorkspaceTemplatePaneNode;
  focusedSessionKey: string | null;
}
