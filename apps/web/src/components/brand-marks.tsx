import {
  siAnthropic,
  siApple,
  siClaude,
  siClaudecode,
  siGithubcopilot,
  siGooglegemini,
  siIcloud,
  siMistralai,
  siOllama,
  siPaypal,
  siPerplexity,
  siVenmo,
  siX,
  siZelle,
} from "simple-icons";

/**
 * Third-party brand marks.
 *
 * Brand marks are deliberately NOT icons and never enter the reicon registry. An icon is a glyph
 * ilo chooses to express a meaning; a brand mark is someone else's trademark, whose artwork we may
 * reproduce but not redesign. They therefore differ on every axis the icon contract governs: their
 * shape is fixed by the owner, some may not be recoloured, and none may be substituted for a
 * similar-looking glyph. This module is the only place in the application allowed to contain inline
 * `<svg>` markup, which `scripts/check-icon-contract.mjs` enforces.
 *
 * Artwork comes from `simple-icons` (CC0-1.0) except where an owner's guidelines require their own
 * asset. simple-icons' CC0 licence covers the path data, not trademark rights: see its
 * DISCLAIMER.md. Every entry below records where its artwork came from.
 *
 * A brand with no entry renders a neutral monogram rather than an approximation. Never hand-draw a
 * trademark to fill a gap.
 */

type BrandMark = {
  /** Human-readable brand name, used for the accessible name. */
  title: string;
  /** 24x24 path data, or a full element for marks that carry required colors. */
  render: () => React.ReactElement;
};

/** simple-icons ships single-path monochrome artwork on a 24x24 grid. */
function monochrome(icon: { title: string; path: string }): BrandMark {
  return {
    title: icon.title,
    render: () => <path d={icon.path} fill="currentColor" />,
  };
}

/**
 * Google requires its own multi-colour asset. Its branding guidelines forbid a monochrome "G" and
 * forbid changing the mark's colors, so `simple-icons`' single-path monochrome Google entry cannot
 * be used here and this artwork stays vendored.
 * Source: https://developers.google.com/identity/branding-guidelines
 */
const googleMark: BrandMark = {
  title: "Google",
  render: () => (
    <>
      <path
        fill="#4285f4"
        d="M21.35 12.28c0-.78-.07-1.53-.2-2.25H12v4.26h5.23a4.47 4.47 0 0 1-1.94 2.93v2.77h3.15c1.84-1.69 2.91-4.18 2.91-7.71Z"
      />
      <path
        fill="#34a853"
        d="M12 22c2.63 0 4.84-.87 6.45-2.36l-3.15-2.77c-.87.58-1.99.93-3.3.93-2.54 0-4.69-1.72-5.46-4.03H3.29v2.84A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#fbbc05"
        d="M6.54 13.77A6 6 0 0 1 6.23 12c0-.62.11-1.21.31-1.77V7.39H3.29A10 10 0 0 0 2 12c0 1.61.39 3.13 1.29 4.61l3.25-2.84Z"
      />
      <path
        fill="#ea4335"
        d="M12 6.2c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.83 3.29 14.63 2 12 2a10 10 0 0 0-8.71 5.39l3.25 2.84C7.31 7.92 9.46 6.2 12 6.2Z"
      />
    </>
  ),
};

/**
 * Keys are lower-cased provider identifiers and connected-client names.
 *
 * Deliberately absent: OpenAI/ChatGPT, Microsoft, Slack, and Plaid. simple-icons removes brands at
 * their owner's request — Microsoft required that only approved, unedited assets be used — so no
 * CC0 artwork exists for them. They render the monogram fallback until we have artwork we are
 * entitled to ship.
 */
const brandMarks: Record<string, BrandMark> = {
  anthropic: monochrome(siAnthropic),
  apple: monochrome(siApple),
  claude: monochrome(siClaude),
  "claude code": monochrome(siClaudecode),
  "claude desktop": monochrome(siClaude),
  copilot: monochrome(siGithubcopilot),
  gemini: monochrome(siGooglegemini),
  "github copilot": monochrome(siGithubcopilot),
  google: googleMark,
  "google gemini": monochrome(siGooglegemini),
  icloud: monochrome(siIcloud),
  mistral: monochrome(siMistralai),
  ollama: monochrome(siOllama),
  paypal: monochrome(siPaypal),
  perplexity: monochrome(siPerplexity),
  venmo: monochrome(siVenmo),
  x: monochrome(siX),
  zelle: monochrome(siZelle),
};

export function hasBrandMark(brand: string) {
  return normalize(brand) in brandMarks;
}

export function brandTitle(brand: string) {
  return brandMarks[normalize(brand)]?.title;
}

function normalize(brand: string) {
  return brand.trim().toLowerCase();
}

/**
 * Renders a brand's mark, or a neutral monogram when we have no artwork we may ship.
 *
 * `label` overrides the accessible name; pass the surrounding context, such as "Google calendar".
 * Set `decorative` when an adjacent visible label already names the brand, so the mark is not
 * announced twice.
 */
export function BrandMark({
  brand,
  className,
  decorative = false,
  label,
}: {
  brand: string;
  className?: string;
  decorative?: boolean;
  label?: string;
}) {
  const mark = brandMarks[normalize(brand)];
  const name = label ?? mark?.title ?? brand;
  const monogram = brand.trim().slice(0, 1).toUpperCase() || "?";

  if (!mark) {
    return decorative ? (
      <span aria-hidden="true" className={className} data-brand-monogram="">
        {monogram}
      </span>
    ) : (
      <span aria-label={name} className={className} data-brand-monogram="" role="img" title={name}>
        {monogram}
      </span>
    );
  }
  // The `<title>` element supplies the native tooltip; `aria-label` supplies the accessible name.
  return decorative ? (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      {mark.render()}
    </svg>
  ) : (
    <svg
      aria-label={name}
      className={className}
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{name}</title>
      {mark.render()}
    </svg>
  );
}
