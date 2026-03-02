// 默认插槽配置文件
export interface SlotConfig {
  left: {
    modules: string[];
    activeModule: string;
  };
  right: {
    modules: string[];
    activeModule: string;
  };
  top: {
    module: string;
  };
  bottom: {
    module: string;
  };
}

export const DEFAULT_SLOT_CONFIG: SlotConfig = {
  left: {
    modules: ['SessionModule', 'SettingsModule'],
    activeModule: 'SessionModule'
  },
  right: {
    modules: ['HistoryModule'],
    activeModule: 'HistoryModule'
  },
  top: {
    module: 'TabModule'
  },
  bottom: {
    module: 'QuickCmdModule'
  }
};

// 可用的模块列表
export const AVAILABLE_MODULES = [
  { id: 'SessionModule', name: '会话管理', icon: 'Folder' },
  { id: 'SettingsModule', name: '设置', icon: 'Settings' },
  { id: 'HistoryModule', name: '历史命令', icon: 'History' },
  { id: 'PluginsModule', name: '插件管理', icon: 'Plug' },
  { id: 'TabModule', name: '标签页', icon: 'Tabs' },
  { id: 'QuickCmdModule', name: '快捷命令', icon: 'Bolt' }
];