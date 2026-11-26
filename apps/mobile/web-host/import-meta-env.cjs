// Babel plugin: translate the Vite `import.meta.env` contract used by the shared web UI into
// the Expo equivalents, so one source tree builds with both Vite and Metro.
//
//   import.meta.env.DEV        -> process.env.NODE_ENV !== "production"
//   import.meta.env.PROD       -> process.env.NODE_ENV === "production"
//   import.meta.env.MODE       -> process.env.NODE_ENV
//   import.meta.env.SSR        -> false (the Expo web target renders on the client)
//   import.meta.env.BASE_URL   -> "/"
//   import.meta.env.VITE_<KEY> -> process.env.EXPO_PUBLIC_<KEY> (inlined by babel-preset-expo)
//
// Any other key, and a bare `import.meta.env`, fails the build instead of silently becoming
// undefined: a new Vite variable needs an explicit Expo mapping.

function isImportMetaEnv(node) {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "MetaProperty" &&
    node.object.meta.name === "import" &&
    node.object.property.name === "meta" &&
    node.property.type === "Identifier" &&
    node.property.name === "env"
  );
}

function expoEnvironmentKey(viteKey) {
  return viteKey.startsWith("VITE_") ? `EXPO_PUBLIC_${viteKey.slice("VITE_".length)}` : null;
}

module.exports = function importMetaEnvPlugin({ types: t }) {
  const processEnv = (key) =>
    t.memberExpression(
      t.memberExpression(t.identifier("process"), t.identifier("env")),
      t.identifier(key),
    );
  const nodeEnvIs = (operator) =>
    t.binaryExpression(operator, processEnv("NODE_ENV"), t.stringLiteral("production"));

  return {
    name: "personal-os-import-meta-env",
    visitor: {
      MetaProperty(path) {
        if (path.node.meta.name !== "import" || path.node.property.name !== "meta") return;
        const env = path.parentPath;
        if (!env.isMemberExpression() || !isImportMetaEnv(env.node)) return;
        const access = env.parentPath;
        if (!access.isMemberExpression() || access.node.object !== env.node || access.node.computed)
          throw env.buildCodeFrameError("Only import.meta.env.<KEY> has an Expo mapping.");
        const key = access.node.property.name;
        if (key === "DEV") access.replaceWith(nodeEnvIs("!=="));
        else if (key === "PROD") access.replaceWith(nodeEnvIs("==="));
        else if (key === "MODE") access.replaceWith(processEnv("NODE_ENV"));
        else if (key === "SSR") access.replaceWith(t.booleanLiteral(false));
        else if (key === "BASE_URL") access.replaceWith(t.stringLiteral("/"));
        else {
          const expoKey = expoEnvironmentKey(key);
          if (!expoKey)
            throw access.buildCodeFrameError(`import.meta.env.${key} has no Expo mapping.`);
          access.replaceWith(processEnv(expoKey));
        }
      },
    },
  };
};

module.exports.expoEnvironmentKey = expoEnvironmentKey;
