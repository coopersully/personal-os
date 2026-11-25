// babel-preset-expo is the default; the extra plugin lets Metro compile the shared web UI,
// which reads Vite's import.meta.env (see web-host/import-meta-env.cjs).
module.exports = (api) => {
  api.cache(true);
  return {
    plugins: [require.resolve("./web-host/import-meta-env.cjs")],
    presets: [
      require.resolve("babel-preset-expo", { paths: [require.resolve("expo/package.json")] }),
    ],
  };
};
