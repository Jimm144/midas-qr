import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.js"],
    // The geometry/matrix suites sweep thousands of rendered SVG nodes and run
    // well past the 5s default when the machine is loaded; 20s still catches
    // genuine hangs without flagging heavy-but-healthy work.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Thresholds exist so a coverage regression fails the build instead of
      // only showing up in a report nobody reads. Set a little under the
      // current numbers; raise them as the gaps close.
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
      include: ["src/js/**/*.js", "src/js/**/*.ts"],
    },
  },
});
