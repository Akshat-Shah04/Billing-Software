import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test file starts its own in-memory PostgreSQL and runs every migration before its tests. On a slow or
    // busy PC (and with all files starting at once) that can take longer than Vitest's default 10 seconds.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
