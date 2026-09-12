// jest-dom's own Vitest augmentation (`@testing-library/jest-dom/vitest`) declares
// `interface Assertion<T = any>`. Vitest 5 gives `Assertion` two type parameters —
// `Assertion<R, T>`, return type first — so the declarations no longer merge and every
// matcher silently disappears from the assertion type. The mismatch is reported inside
// node_modules (TS2428), which `skipLibCheck` hides, so the only visible symptom is
// hundreds of `Property 'toBeInTheDocument' does not exist` errors in our own tests.
//
// `Matchers` is Vitest's supported extension point and reaches `Assertion`,
// `ExpectStatic` and `AsymmetricMatchersContaining` alike, so augmenting it merges
// cleanly — this file type checks with `skipLibCheck` disabled.
//
// Delete this file once jest-dom ships Vitest 5 types: testing-library/jest-dom#738.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  // `R` is the matcher return type, which is what jest-dom's second parameter wants.
  // `T` is unused here but must be declared: TypeScript only merges interfaces whose
  // type parameter lists match Vitest's exactly.
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<unknown, R> {}
}
