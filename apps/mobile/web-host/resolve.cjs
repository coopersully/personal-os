// Metro resolution rules that let the Expo project bundle shared workspace sources.
const { existsSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

const appRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(appRoot, "../..");
const packagesRoot = `${join(workspaceRoot, "packages")}/`;
const webRoot = `${join(workspaceRoot, "apps/web")}/`;
const webSourceRoot = join(webRoot, "src");

// One React renderer per bundle. Shared web sources and their dependencies otherwise resolve
// the web app's own React copy, and hooks fail across the two instances.
const singletonPackages = ["react", "react-dom"];

function isSingleton(moduleName) {
  return singletonPackages.some((name) => moduleName === name || moduleName.startsWith(`${name}/`));
}

/** Maps a NodeNext `.js` specifier to the TypeScript source that exists beside it. */
function typeScriptSource(absoluteSpecifier) {
  if (!absoluteSpecifier.endsWith(".js")) return null;
  const stem = absoluteSpecifier.slice(0, -3);
  for (const extension of [".ts", ".tsx"]) {
    if (existsSync(`${stem}${extension}`)) return `${stem}${extension}`;
  }
  return null;
}

/**
 * Returns the specifier Metro should resolve instead, or null to keep the original.
 * `originModulePath` is the importing file; relative results are absolute paths.
 */
function rewriteSpecifier(originModulePath, moduleName) {
  const fromWeb = originModulePath.startsWith(webRoot);
  const fromShared = fromWeb || originModulePath.startsWith(packagesRoot);
  if (fromWeb && (moduleName === "@" || moduleName.startsWith("@/"))) {
    // The web app's `@/` alias (apps/web/vite.config.ts and tsconfig paths).
    const target = join(webSourceRoot, moduleName.slice(2));
    return typeScriptSource(target) ?? target;
  }
  if (fromShared && moduleName.startsWith(".")) {
    return typeScriptSource(resolve(dirname(originModulePath), moduleName));
  }
  return null;
}

// The web UI is a web-only dependency. Expo Router's native route context still includes
// `.web.tsx` route files, so keep the DOM web UI out of native bundles entirely.
const webOnlyModules = new Set(["@personal-os/web/expo-host"]);

function createResolveRequest() {
  const appOrigin = join(appRoot, "package.json");
  return (context, moduleName, platform) => {
    if (platform !== "web" && webOnlyModules.has(moduleName)) return { type: "empty" };
    if (isSingleton(moduleName) && !context.originModulePath.startsWith(`${appRoot}/`)) {
      return context.resolveRequest(
        { ...context, originModulePath: appOrigin },
        moduleName,
        platform,
      );
    }
    const rewritten = rewriteSpecifier(context.originModulePath, moduleName);
    return context.resolveRequest(context, rewritten ?? moduleName, platform);
  };
}

module.exports = { createResolveRequest, isSingleton, rewriteSpecifier, typeScriptSource };
