import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Module boundaries (docs/architecture/module-boundaries.md): other code
      // may import a business module only through its public index.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*/*"],
              message:
                "Import a module only through its public API (@/modules/<name>). Inside a module, use relative imports.",
            },
          ],
        },
      ],
      // Raw SQL must be parameterised (threat model T6).
      "no-restricted-properties": [
        "error",
        {
          property: "$queryRawUnsafe",
          message: "Use $queryRaw with a tagged template.",
        },
        {
          property: "$executeRawUnsafe",
          message: "Use $executeRaw with a tagged template.",
        },
      ],
      // Stored XSS (threat model T7).
      "react/no-danger": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Business code reaches the database only through withTenant(); the raw
    // client and TenantContext construction stay inside the tenancy layer.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/db/**", "src/lib/tenancy/**", "src/platform/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*/*"],
              message:
                "Import a module only through its public API (@/modules/<name>). Inside a module, use relative imports.",
            },
            {
              group: [
                "@/lib/db",
                "@/lib/db/*",
                "@/generated/*",
                "@/lib/tenancy/internal",
              ],
              message:
                "Use withTenant() and resolveTenantContext() from @/lib/tenancy; the raw client and context constructor are internal.",
            },
          ],
        },
      ],
    },
  },
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
]);

export default eslintConfig;
