import { useLayoutEffect, useRef } from "react";

const reelDigits = Array.from({ length: 30 }, (_, position) => ({
  id: `reel-${position}`,
  digit: position % 10,
}));

function RollingDigit({ digit, direction }: { digit: number; direction: number }) {
  const reel = useRef<HTMLSpanElement>(null);
  const previous = useRef(digit);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = digit;
    const element = reel.current;
    if (
      before === digit ||
      !element?.animate ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    let destination = 10 + digit;
    if (direction > 0 && digit < before) destination += 10;
    if (direction < 0 && digit > before) destination -= 10;
    const animation = element.animate(
      [
        { transform: `translateY(-${(10 + before) * 1.15}em)` },
        { transform: `translateY(-${destination * 1.15}em)` },
      ],
      { duration: 550, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return () => animation.cancel();
  }, [digit, direction]);
  return (
    <span className="relative inline-block h-[1.15em] w-[0.65em] overflow-hidden align-bottom">
      <span
        ref={reel}
        className="absolute inset-x-0 top-0"
        style={{ transform: `translateY(-${(10 + digit) * 1.15}em)` }}
      >
        {reelDigits.map(({ id, digit: reelDigit }) => (
          <span key={id} className="block h-[1.15em] leading-[1.15]">
            {reelDigit}
          </span>
        ))}
      </span>
    </span>
  );
}

/** Directional digit reels; assistive technology reads only the settled, formatted value. */
export function RollingNumber({ value, formatted }: { value: number; formatted: string }) {
  const previous = useRef(value);
  const direction = value >= previous.current ? 1 : -1;
  useLayoutEffect(() => {
    previous.current = value;
  }, [value]);
  // Fixed places from the right retain their reels across carries and formatting changes.
  const places = Array.from(formatted).map((character, index) => ({
    character,
    place: formatted.length - index,
  }));
  return (
    <span className="inline-flex items-start whitespace-nowrap tabular-nums">
      <span className="sr-only">{formatted}</span>
      <span aria-hidden="true" className="inline-flex items-start">
        {places.map(({ character, place }) =>
          /\d/.test(character) ? (
            <RollingDigit key={`digit-${place}`} digit={Number(character)} direction={direction} />
          ) : (
            <span className="inline-block h-[1.15em] leading-[1.15]" key={`separator-${place}`}>
              {character}
            </span>
          ),
        )}
      </span>
    </span>
  );
}
