import { defineConfig } from 'vitest/config';
// separate from vite.config.ts: the Cloudflare plugin can't run under vitest
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000 } });
