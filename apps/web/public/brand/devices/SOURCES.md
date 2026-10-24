# Homepage product previews

## Premiere campaign · October 23, 2026

Eight transparent PNGs were generated with the built-in image generator for nohmi:
`phone-v2`, `laptop-v2`, `monitor-v2`, `tablet-v2`, and the corresponding `figure-*-v2` files.
Exact prompts are in `design-assets/devices/CAMPAIGN-PROMPTS.md`. Preserve original alpha.
Screenshots, device bodies and figures are independent assets, composed in CSS. The phone
floats above an open palm, a leaning figure types on the laptop, an inverted figure peeks from
the monitor's right side, and a reclining figure sits behind the tablet. Position cropped limbs
at the viewport edge. Keep all UI and text clear. A low-opacity animated dither follows each
figure's alpha; reduced motion disables the animation.

Screenshots were captured from the real local app using the opt-in fictional premiere story
for Alex Morgan (`demo+full@nohmi.test`), in light mode. See `docs/engineering/qa-fixtures.md`.

| Asset | Route / state | Viewport |
| --- | --- | --- |
| tasks-premiere.jpg | Tasks / Premiere night, Open & completed | 390 × 890 |
| mail-premiere.jpg | Mail / cinema confirmation and reply | 1280 × 720 |
| calendar-premiere.jpg | Calendar / premiere week, 9:30 am–9 pm | 1360 × 680 |
| finances-premiere.jpg | Finances / Transactions, nine settled records | 1080 × 780 |

The story is a completed independent film approaching its first screening. Funding and freelance
income total $6,800; settled production expenses total $3,520; the film fund retains $3,280.
The screenshots show recorded demo state, not live bank connections or automated agent actions.
Every scene links to its full-size capture. Refresh from the real fixture UI when the app changes.

Earlier generated devices, hand overlays and screenshots in this folder are retained as source
explorations; the homepage uses only the campaign assets above.

### Delivery correction · October 23, 2026

The current page uses WebP copies of the eight transparent device/figure PNG masters
(quality 85, full-quality alpha). Original PNG URLs remain available. The four historic
`*-premiere.png` screenshot URLs are also retained as actual PNG files, alongside the current
JPEG captures. Cached preview pages referenced the PNG names after the previous rename and
received 404s. Keep published asset URLs available when replacing formats. The public artwork
test checks rendered assets, responsive variants, and these earlier screenshot URLs against
actual file signatures.
