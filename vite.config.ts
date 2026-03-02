import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    nodePolyfills(),
  ],
  resolve: {
    alias: {
      // 使用 path.resolve 确保路径正确
      '@': path.resolve(__dirname, './src'),
    },
  },
})
