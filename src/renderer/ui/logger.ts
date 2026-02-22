/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

class Logger {
  // 默认级别：开发环境 DEBUG，生产环境 WARN
  private static level: LogLevel = LogLevel.DEBUG;

  // 样式配置
  private static readonly COLORS: Record<string, string> = {
    DEBUG: 'color: #7f8c8d; font-weight: bold;', // 灰色
    INFO: 'color: #2980b9; font-weight: bold;',  // 蓝色
    WARN: 'color: #f39c12; font-weight: bold;',  // 橙色
    ERROR: 'color: #c0392b; font-weight: bold;', // 红色
    TAG: 'background: #34495e; color: #fff; padding: 1px 4px; border-radius: 3px;'
  };

  /**
   * 动态设置日志级别（方便在控制台实时修改）
   * 使用：window.Logger.setLevel(0)
   */
  static setLevel(level: LogLevel) {
    this.level = level;
    console.log(`%c[Logger]%c LogLevel set to ${LogLevel[level]}`, this.COLORS.TAG, '');
  }

  private static format(level: string, tag: string): string[] {
    const time = new Date().toLocaleTimeString([], { hour12: false, fractionDigits: 3 } as any);
    return [
      `%c${time}%c %c${level}%c %c${tag}%c`,
      'color: #95a5a6;', // 时间颜色
      '',
      this.COLORS[level], // 级别颜色
      '',
      this.COLORS.TAG,    // Tag 背景
      ''
    ];
  }

  static debug(tag: string, ...messages: any[]) {
    if (this.level <= LogLevel.DEBUG) {
      console.log(...this.format('DEBUG', tag), ...messages);
    }
  }

  static info(tag: string, ...messages: any[]) {
    if (this.level <= LogLevel.INFO) {
      console.info(...this.format('INFO', tag), ...messages);
    }
  }

  static warn(tag: string, ...messages: any[]) {
    if (this.level <= LogLevel.WARN) {
      console.warn(...this.format('WARN', tag), ...messages);
    }
  }

  static error(tag: string, ...messages: any[]) {
    if (this.level <= LogLevel.ERROR) {
      console.error(...this.format('ERROR', tag), ...messages);
    }
  }
}

// 暴露给全局以便调试
if (typeof window !== 'undefined') {
  (window as any).Logger = Logger;
}

export { Logger };

// 保持便捷函数导出
export const logDebug = Logger.debug.bind(Logger);
export const logInfo = Logger.info.bind(Logger);
export const logWarn = Logger.warn.bind(Logger);
export const logError = Logger.error.bind(Logger);

export default Logger;