import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx,mjs,cjs}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: [
        'src/engine/resourceContract.mjs',
        'src/engine/explicitResourceContract.mjs',
        'src/engine/taskDecisionKernel.mjs',
        'src/store/appStateReducer.ts',
      ],
      exclude: ['src/engine/**/*.d.mts'],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60,
      },
    },
  },
});
