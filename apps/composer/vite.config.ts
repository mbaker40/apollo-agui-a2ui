/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.COMPOSER_BASE ?? '/',
  plugins: [react()],
  server: {
    port: Number(process.env.COMPOSER_PORT ?? 7464),
    host: true,
  },
  preview: {
    port: Number(process.env.COMPOSER_PORT ?? 7464),
    host: true,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
