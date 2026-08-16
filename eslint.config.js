const browserGlobals = {
  window: "readonly",
  document: "readonly",
  console: "readonly",
  location: "readonly",
  fetch: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  MutationObserver: "readonly",
  getComputedStyle: "readonly",
  isFinite: "readonly",
  YT: "readonly",
};

const nodeGlobals = {
  require: "readonly",
  module: "readonly",
  process: "readonly",
  __dirname: "readonly",
  console: "readonly",
  fetch: "readonly",
  globalThis: "readonly",
  setTimeout: "readonly",
  AbortSignal: "readonly",
};

module.exports = [
  {
    ignores: ["node_modules/**", "site/node_modules/**"],
  },
  {
    files: ["extension/**/*.js", "site/public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "script",
      globals: browserGlobals,
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
    },
  },
  {
    files: ["site/*.js", "site/test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: nodeGlobals,
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
    },
  },
];
