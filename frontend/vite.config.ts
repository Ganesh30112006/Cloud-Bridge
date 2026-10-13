/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // Demo mode serves simulated data. It must never reach a production bundle,
  // so a production build with it enabled fails instead of shipping it.
  if (command === 'build' && mode === 'production' && env.VITE_DEMO_MODE === 'true') {
    throw new Error(
      'VITE_DEMO_MODE=true is not allowed in a production build. ' +
        'Unset it, or build a non-production preview with `vite build --mode demo`.',
    );
  }

  return {
    plugins: [react()],
    server: { port: 5173 },
    preview: { port: 4173 },
    build: { target: 'es2022', sourcemap: true },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
      restoreMocks: true,
      env: { VITE_API_BASE_URL: 'http://api.test', VITE_DEMO_MODE: 'false' },
    },
  };
});
