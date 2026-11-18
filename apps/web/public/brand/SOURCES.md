# Hero photography

Downloaded 2026-10-22. Local WebP derivatives resized to 1600px; muted saturation applied in CSS. No runtime requests to third-party image hosts.

- nature-sunset.webp: Sunset sky water, unknown photographer. CC0 1.0, as recorded at https://commons.wikimedia.org/wiki/File:Sunset_sky_water.jpg
- nature-shore.webp: Blue sunset with shoreline under clouds, Francesco Ungaro. CC0 1.0 (2017 Pexels upload; Commons license-reviewed), https://commons.wikimedia.org/wiki/File:Blue_sunset_with_shoreline_under_clouds.jpg
- nature-twilight.webp: Twilight, clouds and sea at sunset, Commander John Bortniak, NOAA Corps. U.S. federal government public domain, https://commons.wikimedia.org/wiki/File:Twilight,_clouds_and_sea_at_sunset_-_NOAA.jpg

CC0 dedication: https://creativecommons.org/publicdomain/zero/1.0/

## Supplied nature scenery · October 23, 2026

The current hero uses all nine images supplied by Cooper in `nature_scenes_9_4k.zip`.
They replace the earlier nature photographs. Sources are user-provided artwork; do not infer
an open-source or public-domain license. The original archive remains unchanged.

The supplied images contain white collage separators and slivers of adjacent panels along
the top/left edges. The web exports use the clean rectangle `(120, 64, 3712, 2088)` from each
3840 × 2160 source, preserving 16:9 proportions. No content was generated or retouched.
`cwebp -q 78 -m 6` produces 1920 × 1080 and 960 × 540 variants under `brand/scenery/`.
Together the nine large exports are 1,121,920 bytes and the small exports 488,238 bytes.
The hero remains full-bleed with proportional cover sizing, a half-second scene cadence,
a pause control, and a still first frame for reduced motion.

`nohmi-open-arms.webp` reuses the original generated arms-outstretched transparent figure from this design conversation, compressed from `nohmi-figure-transparent.png` (1310 × 1200) at WebP quality 85 with full-quality alpha.

- `nohmi-seated-tablet.webp`: generated for nohmi with the built-in image generation tool, October 23, 2026. Transparent seated mannequin holding a blank square tablet. Master retained in `Documents/Codex/nohmi-brand-assets/nohmi-seated-tablet.png`; WebP quality 88, alpha quality 100. The actual app mark is overlaid separately from `/icon.svg`.

- `nohmi-standing-icon.webp`: built-in image-generation edit of the seated figure, October 23, 2026. Upright transparent upper body; master in `Documents/Codex/nohmi-brand-assets/nohmi-standing-icon.png`. CSS masks the blank tile and preserves foreground fingers around the exact `/icon.svg` overlay.
