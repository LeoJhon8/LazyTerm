import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    ...(mode === 'demo' ? [{
      name: 'lazyterm-demo-entry',
      transformIndexHtml: {
        order: 'pre' as const,
        handler: (html: string) => html.replace('/src/main.tsx', '/src/demo/main.tsx'),
      },
    }] : []),
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    nodePolyfills(),
  ],
  resolve: {
    alias: {
      ...(mode === 'demo' ? {
        '@/connectors/ConnectorFactory': path.resolve(__dirname, 'src/demo/ConnectorFactory.ts'),
        '@/services/appStorage': path.resolve(__dirname, 'src/demo/storage.ts'),
        '@/services/tauri': path.resolve(__dirname, 'src/demo/tauri.ts'),
        '@/services/gitService': path.resolve(__dirname, 'src/demo/unavailable.ts'),
        '@/services/systemNotificationService': path.resolve(__dirname, 'src/demo/systemNotifications.ts'),
        '@/hooks/useUpdateNotification': path.resolve(__dirname, 'src/demo/updateNotification.ts'),
        '@/components/dialogs/SftpUploadDialog': path.resolve(__dirname, 'src/demo/SftpDialogs.tsx'),
        '@/components/dialogs/SftpDownloadDialog': path.resolve(__dirname, 'src/demo/SftpDialogs.tsx'),
        '@tauri-apps/plugin-fs': path.resolve(__dirname, 'src/demo/unavailable.ts'),
        '@tauri-apps/plugin-dialog': path.resolve(__dirname, 'src/demo/unavailable.ts'),
        '@tauri-apps/plugin-http': path.resolve(__dirname, 'src/demo/unavailable.ts'),
        '@tauri-apps/plugin-opener': path.resolve(__dirname, 'src/demo/unavailable.ts'),
      } : {}),
      // 使用 path.resolve 确保路径正确
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist' },
}))
