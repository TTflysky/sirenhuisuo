import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Electron 渲染层构建配置：
// - base './' 让打包后的 index.html 可用 file:// 直接加载
// - outDir 'dist' 与 electron/main.cjs 中的 loadFile 路径对齐
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
