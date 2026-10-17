import tseslint from "typescript-eslint";

/**
 * Pemeriksaan khusus kode async: setelah pindah ke MySQL hampir semua akses database berupa
 * Promise, dan `await` yang terlupa membuat penulisan lolos tanpa ditunggu atau error tertelan.
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "eslint.config.js"] },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false, attributes: false } }],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-array-sort-compare": "off",
    },
  },
);
