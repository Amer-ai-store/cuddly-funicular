// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // The packed 3D engines are generated string literals (tools/build-web-engines.mjs), not code to lint.
    ignores: ["dist/*", "src/components/character/webEngines.generated.ts"],
  },
]);
