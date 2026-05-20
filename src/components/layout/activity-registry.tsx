import type { ComponentType, ReactNode } from "react";
import { Folder, History } from "lucide-react";
import { SessionModule } from "@/components/modules/SessionModule";
import { HistoryModule } from "@/components/modules/HistoryModule";

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
};

export function getValidActivityModules(modules: string[]): ActivityModuleDefinition[] {
  return modules
    .map((id) => ACTIVITY_MODULES[id])
    .filter((definition): definition is ActivityModuleDefinition => Boolean(definition))
    .sort((a, b) => a.priority - b.priority);
}

export function countValidModules(modules: string[]): number {
  return getValidActivityModules(modules).length;
}
