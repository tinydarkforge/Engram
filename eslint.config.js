import js from "@eslint/js";

const nodeGlobals = {
  require: "readonly",
  module: "readonly",
  exports: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  setImmediate: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  fetch: "readonly",
  global: "readonly"
};

export default [
  js.configs.recommended,
  {
    ignores: ["node_modules/**", "coverage/**", "content/**"]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: nodeGlobals
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off"
    }
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: nodeGlobals
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off"
    }
  }
];
