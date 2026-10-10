import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Os testes compartilham um banco real: rodam em sequência.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
