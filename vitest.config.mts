import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Coverage is measured only on the pure domain logic. React components and
      // the thin API-route wrappers are exercised via integration tests but are
      // not held to a line threshold -- chasing that number there produces
      // vanity coverage rather than confidence.
      include: [
        "src/lib/flags.ts",
        "src/lib/decode.ts",
        "src/lib/address.ts",
        "src/lib/proxy.ts",
        "src/lib/risk.ts",
        "src/lib/pools.ts",
        "src/lib/chains.ts",
      ],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
