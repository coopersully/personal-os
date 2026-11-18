import "@testing-library/jest-dom/vitest";

// Hosted runners are slower and busier than a development machine. As with the
// test timeout in vitest.config.ts, give DOM waits headroom there: an assertion
// still has to become true, it is only allowed longer than one second to do so.
if (process.env.CI && typeof window !== "undefined") {
  const { configure } = await import("@testing-library/react");
  configure({ asyncUtilTimeout: 5_000 });
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

if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.hasPointerCapture ??= () => false;
}
