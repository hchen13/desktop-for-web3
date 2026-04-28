// ESLint v9 flat config
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import solidPlugin from 'eslint-plugin-solid';

export default [
  {
    ignores: [
      'dist/**',
      'worker/dist/**',
      'worker/node_modules/**',
      'node_modules/**',
      'tests/screenshots/**',
      'tests/run-automated-test.cjs',
      '**/*.config.{js,ts,cjs,mjs}',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        chrome: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        Image: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        DOMParser: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Promise: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        HTMLElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLImageElement: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        Event: 'readonly',
        DOMRect: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        Intl: 'readonly',
        Math: 'readonly',
        Date: 'readonly',
        JSON: 'readonly',
        process: 'readonly',
        global: 'readonly',
        self: 'readonly',
        location: 'readonly',
        crypto: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        ResizeObserver: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        performance: 'readonly',
        getComputedStyle: 'readonly',
        Worker: 'readonly',
        BroadcastChannel: 'readonly',
        CustomEvent: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      solid: solidPlugin,
    },
    rules: {
      // TS plugin recommended subset
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Disable base no-unused-vars since TS handles it
      'no-unused-vars': 'off',
      // 生产代码不允许 console.log，但 warn/error 允许
      'no-console': ['warn', { allow: ['warn', 'error', 'debug'] }],
      'no-undef': 'off', // TS handles this; no-undef in ESLint v9 is unreliable for DOM globals
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Solid 推荐规则（all errors downgraded to warn — gradually fix existing)
      ...(solidPlugin.configs?.typescript?.rules ?? {}),
      'solid/prefer-for': 'warn',
      'solid/no-innerhtml': 'warn',
      'solid/no-react-deps': 'warn',
      'solid/reactivity': 'warn',
      'solid/components-return-once': 'warn',
      'solid/event-handlers': 'warn',
    },
  },
  {
    // 测试文件放宽限制
    files: ['src/**/*.test.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
