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
  clearInterval: "readonly",
  MutationObserver: "readonly",
  getComputedStyle: "readonly",
  isFinite: "readonly",
  YT: "readonly",
  CaptionView: "readonly",
  CaptionOverlay: "readonly",
  CAPTION_MODE_CONFIG: "readonly",
  chrome: "readonly",
  navigator: "readonly",
};

const nodeGlobals = {
  URL: "readonly",
  URLSearchParams: "readonly",
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
    // Build tooling for the root package, which is CommonJS.
    files: ["scripts/**/*.js"],
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
  {
    // The extension's ES modules: the service worker and its copy of the
    // shared transcript module.
    files: ["extension/worker.js", "extension/vendor/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...browserGlobals,
        chrome: "readonly",
        AbortSignal: "readonly",
        navigator: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
    },
  },
  {
    files: ["extension/**/*.js", "site/public/**/*.js"],
    ignores: ["extension/worker.js", "extension/vendor/**/*.js"],
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
    files: [
      "site/*.js",
      "site/api/**/*.js",
      "site/lib/**/*.js",
      "site/test/**/*.js",
      "transcript-core/**/*.js",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
    },
  },
];
