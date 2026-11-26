// PostCSS plugin: Metro does not copy files referenced by CSS url(). The shared web UI's
// Geist font faces point into node_modules, so serve them from public/fonts/geist instead
// (a link to the installed @fontsource-variable/geist files).
const fontsourceFiles = /url\((["']?)[^"')]*@fontsource-variable\/geist\/files\/([^"')]+)\1\)/g;

export function rewriteGeistFontUrls(value) {
  return value.replace(
    fontsourceFiles,
    (_match, quote, file) => `url(${quote}/fonts/geist/${file}${quote})`,
  );
}

export const geistFontUrls = {
  postcssPlugin: "personal-os-geist-font-urls",
  Declaration(declaration) {
    if (declaration.value.includes("@fontsource-variable/geist/files/"))
      declaration.value = rewriteGeistFontUrls(declaration.value);
  },
};
