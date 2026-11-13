import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Whether an element has come within `rootMargin` of the viewport, once — it
 * stays true after that (#37). A row's thumbnail is fetched with the token
 * rather than by an `<img loading="lazy">`, which cannot send it, so this is
 * the lazy loading the browser would otherwise have done: a long collection
 * fetches the thumbnails it shows, not all of them.
 *
 * Where there is no IntersectionObserver (jsdom), everything counts as seen.
 */
export function useSeen<T extends Element>(rootMargin = "200px"): [(node: T | null) => void, boolean] {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(() => () => observer.current?.disconnect(), []);

  const ref = useCallback(
    (node: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!node || seen || typeof IntersectionObserver === "undefined") return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setSeen(true);
            observer.current?.disconnect();
          }
        },
        { rootMargin },
      );
      observer.current.observe(node);
    },
    [seen, rootMargin],
  );

  return [ref, seen];
}
