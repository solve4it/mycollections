import "@testing-library/jest-dom";
import "./i18n/index.js";

// jsdom has no ResizeObserver, and every browser the app supports does. A no-op
// stand-in, so a screen that measures itself (lib/overlay-clearance.ts, #372)
// renders under test; the hook's own test installs one it can drive.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
