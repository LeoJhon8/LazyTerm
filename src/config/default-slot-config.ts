// 默认插槽配置文件
export interface SlotConfig {
  left: {
    modules: string[];
    activeModule: string;
    collapsed?: boolean;
  };
  right: {
    modules: string[];
    activeModule: string;
    collapsed?: boolean;
  };
  top: {
    module: string;
  };
  bottom: {
    module: string;
  };
  quickCmdBarEnabled: boolean;  // 是否显示快捷命令栏
}

export const DEFAULT_SLOT_CONFIG: SlotConfig = {
  left: {
    modules: ['SessionModule'],
    activeModule: 'SessionModule',
    collapsed: false
  },
  right: {
    modules: ['HistoryModule'],
    activeModule: 'HistoryModule',
    collapsed: false
  },
  top: {
    module: 'TabModule'
  },
  bottom: {
    module: 'QuickCmdModule'
  },
  quickCmdBarEnabled: true  // 默认显示快捷命令栏
};

// 可用的模块列表（设置模块已移除，通过全局入口访问）
export const AVAILABLE_MODULES = [
  { id: 'SessionModule', name: '会话管理', icon: 'Folder' },
  { id: 'HistoryModule', name: '历史命令', icon: 'History' },
  { id: 'TabModule', name: '标签页', icon: 'Tabs' },
  { id: 'QuickCmdModule', name: '快捷命令', icon: 'Bolt' }
];

// 锁定的模块配置（不可更改位置）
export const LOCKED_MODULES = ['TabModule', 'QuickCmdModule'];

// 可分配到左/右侧栏的有效模块 ID 集合（用于校验持久化数据）
export const VALID_SLOT_MODULE_IDS = new Set(
  AVAILABLE_MODULES
    .filter(m => !LOCKED_MODULES.includes(m.id))
    .map(m => m.id)
);
