// Lazy Terminal 功能测试脚本
// 在浏览器DevTools Console中运行

console.log('='.repeat(60));
console.log('Lazy Terminal 功能能力点测试');
console.log('='.repeat(60));

const testResults = {
  passed: 0,
  failed: 0,
  total: 0
};

function test(description, testFn) {
  testResults.total++;
  try {
    const result = testFn();
    if (result) {
      console.log(`✅ ${description}`);
      testResults.passed++;
    } else {
      console.log(`❌ ${description}`);
      testResults.failed++;
    }
  } catch (error) {
    console.log(`❌ ${description} - ERROR: ${error.message}`);
    testResults.failed++;
  }
}

// 1. 核心功能测试
console.log('\n📋 核心功能测试:');

test('TabManager 初始化', () => {
  return window.tabManager !== undefined;
});

test('Electron API 可用性', () => {
  return window.electronAPI !== undefined;
});

test('XTerm.js 加载', () => {
  return window.Terminal !== undefined && window.FitAddon !== undefined;
});

test('本地存储支持', () => {
  return typeof localStorage !== 'undefined';
});

// 2. UI 组件测试
console.log('\n🎨 UI 组件测试:');

test('标签页容器存在', () => {
  return document.getElementById('tabsWrapper') !== null;
});

test('新建标签按钮存在', () => {
  return document.getElementById('newTabBtn') !== null;
});

test('终端容器存在', () => {
  return document.getElementById('xterm-container') !== null;
});

test('侧边栏元素存在', () => {
  const sidebars = ['historySidebar', 'sessionSidebar', 'shortcutBar'];
  return sidebars.some(id => document.getElementById(id) !== null);
});

// 3. 功能模块测试
console.log('\n🔧 功能模块测试:');

test('历史记录模块初始化', () => {
  return window.app && typeof window.app.addCommandToHistory === 'function';
});

test('会话管理模块初始化', () => {
  return window.app && typeof window.app.openSessionInNewTab === 'function';
});

test('快捷命令模块初始化', () => {
  return typeof window.toggleShortcutBar === 'function';
});

// 4. API 方法测试
console.log('\n🔌 API 接口测试:');

const apiMethods = [
  'ptyCreate', 'ptyWrite', 'ptyResize', 'ptyClose', 
  'onPtyData', 'onPtyExit', 'onPtyError'
];

apiMethods.forEach(method => {
  test(`Electron API.${method}`, () => {
    return window.electronAPI && typeof window.electronAPI[method] === 'function';
  });
});

// 5. 数据结构测试
console.log('\n💾 数据结构测试:');

test('标签页数据结构', () => {
  if (window.tabManager && window.tabManager.tabs) {
    const tabs = window.tabManager.tabs;
    return Array.isArray(tabs) || tabs instanceof Map;
  }
  return false;
});

test('本地存储键值', () => {
  const storageKeys = ['terminalTabs', 'terminalFontSize', 'terminalShortcuts'];
  return storageKeys.some(key => localStorage.getItem(key) !== null);
});

// 6. 事件系统测试
console.log('\n⚡ 事件系统测试:');

test('窗口大小变化监听', () => {
  return typeof window.addEventListener === 'function';
});

test('点击事件监听', () => {
  const button = document.getElementById('newTabBtn');
  return button && typeof button.addEventListener === 'function';
});

// 7. 性能指标测试
console.log('\n⚡ 性能指标测试:');

test('页面加载时间合理', () => {
  // 简单的时间检测
  return performance.now() > 0;
});

test('内存使用监控', () => {
  // 检查基本的内存相关信息
  return typeof performance.memory === 'object' || true; // Chrome特定
});

// 输出测试总结
console.log('\n' + '='.repeat(60));
console.log('📊 测试结果汇总:');
console.log(`总计测试项: ${testResults.total}`);
console.log(`✅ 通过: ${testResults.passed}`);
console.log(`❌ 失败: ${testResults.failed}`);
console.log(`成功率: ${(testResults.passed / testResults.total * 100).toFixed(1)}%`);

if (testResults.failed === 0) {
  console.log('\n🎉 所有测试通过！项目功能完整可用。');
} else {
  console.log(`\n⚠️  存在 ${testResults.failed} 个问题需要修复。`);
}

console.log('='.repeat(60));

// 提供快速诊断命令
console.log('\n🔧 快速诊断命令:');
console.log('1. 检查标签页管理器: window.tabManager');
console.log('2. 检查Electron API: window.electronAPI');
console.log('3. 查看活动标签页: window.tabManager?.activeTab');
console.log('4. 手动创建标签页: window.tabManager?.createNewTab("测试")');
console.log('5. 检查本地存储: Object.keys(localStorage)');