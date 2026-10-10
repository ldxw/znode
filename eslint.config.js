import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // 防止 TDZ 白屏：IIFE / 顶层语句里用到后面才声明的 state 时，tsc 与打包器都不会报错，只有运行时会崩
      "@typescript-eslint/no-use-before-define": [
        "warn",
        { functions: false, variables: true, classes: true, enums: true, typedefs: false, ignoreTypeReferences: true },
      ],
    },
  },
);
