import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["**/*.ts", "**/*.mjs", "scripts/sanitize-fixture"],
    extends: [tseslint.configs.recommended],
  },
);
