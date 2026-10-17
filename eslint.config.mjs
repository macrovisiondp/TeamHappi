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
    // Platform operations (and the platform-staff actor) are not importable from
    // application code until Milestone 3 adds the session-backed issuer.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/db/**",
      "src/lib/tenancy/**",
      "src/lib/auth/**",
      // Workspace layer (M4.1): resolves the organisation from the session and
      // is the only route from pages to withTenant().
      "src/lib/workspace/**",
      "src/platform/**",
      "src/app/api/auth/**",
    ],
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
                "@/lib/tenancy/tx-budget",
                "@/lib/auth/config",
                "@/lib/auth/db",
                "@/lib/auth/provision",
                "@/lib/auth/session",
                "@/lib/auth/mailer",
                "@/platform/authz/*",
                "@/platform/tenancy/*",
              ],
              message:
                "Internal module. Use withTenant()/resolveTenantContext() from @/lib/tenancy and getCurrentUser() from @/lib/auth. Platform operations are not reachable from application code until Milestone 3.",
            },
          ],
        },
      ],
    },
  },
  {
    // M5.1: the platform access layer is the one place outside src/platform
    // that may issue a PlatformStaffActor (after staff + MFA checks). It gets
    // no other new imports.
    files: ["src/lib/platform-access/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*/*"],
              message: "Import a module only through its public API.",
            },
            {
              group: [
                "@/lib/db",
                "@/lib/db/*",
                "@/generated/*",
                "@/lib/tenancy/internal",
                "@/lib/tenancy/tx-budget",
                "@/lib/auth/config",
                "@/lib/auth/db",
                "@/lib/auth/provision",
                "@/lib/auth/session",
                "@/lib/auth/mailer",
                "@/platform/tenancy/*",
              ],
              message: "Internal module.",
            },
          ],
        },
      ],
    },
  },
  {
    // Tenant context may only be set transaction-locally, in one place.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/tenancy/with-tenant.ts", "src/generated/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "TemplateElement[value.raw=/set_config|(^|[^a-z_])(set|reset)[ ]+(session[ ]+|local[ ]+)?app[.]/i]",
          message:
            "Tenant context is set only by withTenant() (src/lib/tenancy/with-tenant.ts).",
        },
        {
          selector:
            "Literal[value=/set_config|(^|[^a-z_])(set|reset)[ ]+(session[ ]+|local[ ]+)?app[.]/i]",
          message:
            "Tenant context is set only by withTenant() (src/lib/tenancy/with-tenant.ts).",
        },
        {
          selector:
            "MemberExpression[object.name='Prisma'][property.name='raw']",
          message:
            "Prisma.raw builds unparameterised SQL; use tagged templates.",
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
