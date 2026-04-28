import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [
    solidPlugin({
      // Solid 编译器需要处理 .ts 中的 JSX（如 EventOrchestrator.ts）
      extensions: ['.ts', '.tsx', '.jsx'],
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
      'tests/integration/**/*.test.tsx',
    ],
    exclude: ['node_modules', 'dist', 'worker', 'tests/run-automated-test.cjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/newtab/**',
        'src/**/index.ts',
        'src/i18n/**',
        'src/manifest.json',
      ],
    },
    deps: {
      optimizer: {
        web: {
          include: ['solid-js'],
        },
      },
    },
  },
  resolve: {
    conditions: ['development', 'browser'],
  },
});
