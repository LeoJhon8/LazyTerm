// JavaScript Console Debug Script for Lazy Terminal
// 在浏览器DevTools的Console中运行此脚本进行快速检查

console.log('='.repeat(50));
console.log('Lazy Terminal 功能检查');
console.log('='.repeat(50));

// 1. 检查TabManager实例
if (window.tabManager) {
  console.log('✅ TabManager 已初始化');
  console.log('   活动标签页ID:', window.tabManager.activeTabId);
  console.log('   标签页数量:', window.tabManager.tabs.length);
} else {
  console.log('❌ TabManager 未找到');
}

// 2. 检查关键DOM元素
const elements = {
  'newTabBtn': document.getElementById('newTabBtn'),
  'newConnectionBtn': document.getElementById('newConnectionBtn'),
  'saveSessionBtn': document.getElementById('saveSessionBtn'),
  'toggleShortcutBtn': document.getElementById('toggleShortcutBtn'),
  'toggleHistoryBtn': document.getElementById('toggleHistoryBtn'),
  'shortcutBar': document.getElementById('shortcutBar'),
  'historySidebar': document.getElementById('historySidebar'),
  'sessionSidebar': document.getElementById('sessionSidebar'),
  'xterm-container': document.getElementById('xterm-container'),
  'terminalWrapper': document.getElementById('terminalWrapper'),
  'tabsWrapper': document.getElementById('tabsWrapper')
};

console.log('\nDOM元素检查:');
const missingElements = [];
for (const [name, el] of Object.entries(elements)) {
  if (el) {
    console.log(`  ✅ ${name}`);
  } else {
    console.log(`  ❌ ${name} 未找到`);
    missingElements.push(name);
  }
}

// 3. 检查按钮事件监听器
console.log('\n按钮事件监听器检查:');
if (window.tabManager) {
  const buttons = {
    'newTabBtn': window.tabManager.newTabBtn,
    'historySidebar_toggleBtn': document.getElementById('toggleHistoryBtn'),
    'shortcutBar_toggleBtn': document.getElementById('toggleShortcutBtn'),
  };

  for (const [name, btn] of Object.entries(buttons)) {
    if (btn) {
      const listeners = getEventListeners ? getEventListeners(btn) : 'N/A';
      console.log(`  ✅ ${name}`, listeners);
    } else {
      console.log(`  ⚠️  ${name} 为 null`);
    }
  }
}

// 4. 检查electronAPI
console.log('\nElectron API 检查:');
if (window.electronAPI) {
  console.log('  ✅ electronAPI 已加载');
  const methods = ['ptyCreate', 'ptyWrite', 'ptyResize', 'ptyClose', 'onPtyData'];
  for (const method of methods) {
    if (typeof window.electronAPI[method] === 'function') {
      console.log(`    ✅ ${method}`);
    } else {
      console.log(`    ❌ ${method}`);
    }
  }
} else {
  console.log('  ❌ electronAPI 未找到');
}

// 5. 检查xterm.js
console.log('\nxterm.js 检查:');
if (window.Terminal) {
  console.log('  ✅ Terminal 类已加载');
} else {
  console.log('  ❌ Terminal 未加载');
}

if (window.FitAddon) {
  console.log('  ✅ FitAddon 已加载');
} else {
  console.log('  ❌ FitAddon 未加载');
}

// 6. 检查localStorage
console.log('\nLocalStorage 检查:');
const keys = ['terminalTabs', 'terminalFontSize', 'terminalShortcuts', 'savedSessions', 'globalCommandHistory'];
for (const key of keys) {
  const value = localStorage.getItem(key);
  if (value) {
    console.log(`  ✅ ${key} (${value.length} bytes)`);
  } else {
    console.log(`  ⚠️  ${key} 为空或未设置`);
  }
}

// 7. 总结
console.log('\n' + '='.repeat(50));
console.log('检查总结:');
const issues = missingElements.length;
if (issues === 0) {
  console.log('✅ 所有检查通过！应用应该正常工作。');
} else {
  console.log(`⚠️  发现 ${issues} 个问题:`);
  missingElements.forEach(el => console.log(`    - ${el}`));
}
console.log('='.repeat(50));

// 提供快速功能测试
console.log('\n快速功能测试命令:');
console.log('  测试创建标签页: tabManager.createTab("测试标签", "local")');
console.log('  切换标签页: tabManager.switchTab(1)');
console.log('  查看活动标签页: tabManager.activeTab');
console.log('  列出所有标签页: tabManager.tabs.forEach(t => console.log(t))');
console.log('  手动触发新标签按钮: document.getElementById("newTabBtn").click()');
