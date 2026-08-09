import type { ComponentType, ReactNode } from "react";
import { Bot, Folder, History } from "lucide-react";
import { SessionModule } from "@/components/modules/SessionModule";
import { HistoryModule } from "@/components/modules/HistoryModule";
import { AiModule } from "@/components/modules/AiModule";

export interface ActivityModuleDefinition {
  id: string;
  component: ComponentType;
  icon: ReactNode;
  priority: number;
}

export const ACTIVITY_MODULES: Record<string, ActivityModuleDefinition> = {
  SessionModule: {
    id: "SessionModule",
    component: SessionModule,
    icon: <Folder className="h-5 w-5" />,
    priority: 10,
  },
  HistoryModule: {
    id: "HistoryModule",
    component: HistoryModule,
    icon: <History className="h-5 w-5" />,
    priority: 20,
  },
  AiModule: {
    id: "AiModule",
    component: AiModule,
    icon: <Bot className="h-5 w-5" />,
    priority: 30,
  },
};

export function getValidActivityModules(
  modules: string[],
  aiConfigured: boolean,
): ActivityModuleDefinition[] {
  return modules
    .map((id) => ACTIVITY_MODULES[id])
    .filter((definition): definition is ActivityModuleDefinition => (
      Boolean(definition) && (definition?.id !== "AiModule" || aiConfigured)
    ))
    .sort((a, b) => a.priority - b.priority);
}

export function countValidModules(modules: string[], aiConfigured: boolean): number {
  return getValidActivityModules(modules, aiConfigured).length;
}
