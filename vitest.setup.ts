import "@testing-library/jest-dom/vitest";
import { afterAll } from "vitest";
import type {} from "vitest/jsdom";

// Node 25+ defines host Web Storage even without a backing file. Vitest 3 leaves
// those existing globals in place, so explicitly use this jsdom document's stores.
if (typeof jsdom !== "undefined") {
  const stores = ["localStorage", "sessionStorage"] as const;
  const originals = stores.map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, writable: true, value: jsdom.window.localStorage },
    sessionStorage: { configurable: true, writable: true, value: jsdom.window.sessionStorage },
  });
  afterAll(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
}

class ResizeObserverMock {
  disconnect() {}

  observe() {}

  unobserve() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
}
