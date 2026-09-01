/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// COMPOSER_BASE is set by the Pages workflow (/apollo-agui-a2ui/catalog/); dev stays '/'.
export default defineConfig({
  base: process.env.COMPOSER_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 7465,
    host: true,
  },
  preview: {
    port: 7465,
    host: true,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/test-setup.ts'],
    server: {
      deps: {
        inline: [/@a2ui\/react/, /@a2ui\/web_core/],
      },
    },
  },
});
