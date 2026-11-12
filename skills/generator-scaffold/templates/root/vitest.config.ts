import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const at = (folder: string): string => fileURLToPath(new URL(folder, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@api': at('./__API_DIR__'), '@shared': at('./__SHARED_DIR__') } },
  test: { include: ['generators/**/*.test.ts', '__API_DIR__/**/*.test.ts'] },
});
