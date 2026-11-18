const { existsSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
const packagesRoot = `${resolve(__dirname, "../../packages")}/`;
// Shared NodeNext packages use .js specifiers for TypeScript sources. Preserve those
// public imports and teach Metro the same source resolution as the web bundler.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    context.originModulePath.startsWith(packagesRoot) &&
    moduleName.startsWith(".") &&
    moduleName.endsWith(".js")
  ) {
    const source = `${moduleName.slice(0, -3)}.ts`;
    if (existsSync(resolve(dirname(context.originModulePath), source))) {
      return context.resolveRequest(context, source, platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
