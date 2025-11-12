import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginImport from "eslint-plugin-import";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      import: eslintPluginImport
    },
    rules: {
      "import/extensions": "off",
      "import/no-extraneous-dependencies": [
        "error",
        {
          devDependencies: [
            "eslint.config.mjs",
            "tsconfig.json"
          ]
        }
      ],
      "import/order": [
        "error",
        {
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true
          },
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"]
          ]
        }
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: false
        }
      ]
    }
  },
  {
    ignores: [
      "dist",
      "node_modules"
    ]
  }
];

