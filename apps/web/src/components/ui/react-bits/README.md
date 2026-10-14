# React Bits Glass Surface

Vendored from https://github.com/DavidHDev/react-bits/tree/496968c4117e21278f13917201b7d615bc5e7450/src/ts-default/Components/GlassSurface
(documentation: https://reactbits.dev/components/glass-surface).

Copyright David Haz; MIT + Commons Clause, included in LICENSE.md. Used within nohmi, not sold as a component library.

The upstream optical renderer is retained, with strict indexed-read typing, GPU setup/asynchronous cleanup guards, app-stylesheet CSS loading (SSR-safe), accessibility markup and unique per-instance filter IDs. Shared app composition and semantic surface treatment live in liquid-glass.tsx and materials.css. SVG markup is filter machinery, not icon artwork.
