import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

// Electron 渲染层构建配置：
// - base './' 让打包后的 index.html 可用 file:// 直接加载
// - outDir 'dist' 与 electron/main.cjs 中的 loadFile 路径对齐
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll('\\', '/');
          if (normalized.includes('/src/data/generatedExpertCatalog.ts')) return 'expert-catalog';
          if (normalized.includes('/node_modules/antd/') || normalized.includes('/node_modules/@ant-design/')) return 'ui-vendor';
          if (normalized.includes('/node_modules/react/') || normalized.includes('/node_modules/react-dom/') || normalized.includes('/node_modules/scheduler/')) return 'react-vendor';
          if (normalized.includes('/node_modules/docx/') || normalized.includes('/node_modules/officeparser/')) return 'document-vendor';
          return undefined;
        },
      },
    },
  },
});
