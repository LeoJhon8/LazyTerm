import { useI18n } from '@/i18n';

const messages = {
  label: ['演示版 · 数据仅保存在内存', 'Demo · data stays in memory'],
  reset: ['重置演示', 'Reset demo'],
  hint: ['SSH：输入 help；SFTP：会话右键菜单。重置会关闭演示会话。', 'SSH: type help. SFTP: session context menu. Reset closes demo sessions.'],
  upload: ['SFTP 演示上传', 'SFTP demo upload'],
  download: ['SFTP 演示下载', 'SFTP demo download'],
  note: ['仅操作虚拟文件，不读取或写入电脑文件。上传将添加 sample-upload.txt。', 'Virtual files only. No computer files are read or written. Upload adds sample-upload.txt.'],
  up: ['上级目录', 'Parent directory'],
  refresh: ['刷新', 'Refresh'],
  startUpload: ['上传示例文件', 'Upload sample file'],
  startDownload: ['模拟下载所选文件', 'Simulate selected download'],
  cancel: ['取消传输', 'Cancel transfer'],
  cancelled: ['演示传输已取消', 'Demo transfer cancelled'],
  complete: ['演示传输完成（未写入电脑）', 'Demo transfer complete (nothing written to computer)'],
  progress: ['演示传输中', 'Demo transfer in progress'],
  empty: ['目录为空', 'Empty directory'],
  unavailable: ['此演示场景无法认证，请选择其他服务器。', 'This scenario rejects authentication. Choose another server.'],
} as const;

export function useDemoText() {
  const { locale } = useI18n();
  return (key: keyof typeof messages) => messages[key][locale === 'zh-CN' ? 0 : 1];
}
