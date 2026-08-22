/**
 * Rewrites the relative Markdown links in the shared user docs to real page URLs.
 *
 * `docs/*.md` is read in two places and has to work in both: on GitHub, where
 * `[Items](./items.md)` resolves to the file next to it, and on this Starlight
 * site, where that same href has to become `/mycollections/user/items/`. Editing
 * the source links would fix one reader by breaking the other, so the rewrite
 * happens here — at build time, on the generated copy — and the authoring rule in
 * `docs/README.md` stays "use relative links".
 *
 * The target URL is derived from where the linked *file* sits under the content
 * root, not from the URL of the page doing the linking, so a link out of
 * `user/index.md` lands in the same place as the identical link out of
 * `user/items.md`.
 *
 * This is a Sätteri hast plugin — the AST pass Astro 7's default Markdown
 * processor exposes. The older `markdown.rehypePlugins` array would work too,
 * but only by swapping the whole site onto the legacy unified processor, and it
 * warns that it is deprecated.
 *
 * Links inside code, fenced or inline, never become `<a>` elements, so they are
 * skipped for free — which a rewrite over the Markdown source could not manage.
 */
import { existsSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Anything with a scheme, a protocol-relative host, a bare anchor, or an absolute path. */
const NON_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|[#/])/i;

/**
 * @param {{ base: string, contentRoot: string }} options
 *   `base` is the site's base path; `contentRoot` is the directory whose layout
 *   defines the site's URLs (`src/content/docs`).
 */
export function satteriRelativeDocLinks({ base, contentRoot }) {
  const prefix = base.replace(/\/$/, "");

  return {
    name: "relative-doc-links",
    element: {
      filter: ["a"],
      visit(node, ctx) {
        const href = node.properties?.href;
        if (typeof href !== "string" || NON_RELATIVE.test(href)) return;

        // Without the source file there is nothing to resolve the link against,
        // so leave it alone rather than guess.
        if (!ctx.fileURL) return;

        const [, encoded, suffix = ""] = href.match(/^([^#?]*)([#?].*)?$/) ?? [];
        if (!encoded) return;
        // Markdown percent-encodes what it must; the filesystem wants it back.
        const path = decodeURIComponent(encoded);
        if (!/\.mdx?$/.test(path)) return;

        // A link that climbs out of the content root points at something this
        // site does not publish, and a link to a file that is not there is a
        // typo. Both are left alone for `check-built-links.mjs` to fail the
        // build over. Reporting an error from here would not fail it: Starlight
        // catches a render error, logs it, and publishes the page with an empty
        // body, exit code 0.
        const absolute = resolve(fileURLToPath(ctx.fileURL), "..", path);
        const target = relative(contentRoot, absolute);
        if (target.startsWith("..") || !existsSync(absolute)) return;

        const slug = target
          .split(sep)
          .join(posix.sep)
          .replace(/\.mdx?$/, "")
          .replace(/(^|\/)index$/, "");
        ctx.setProperty(node, "href", `${prefix}/${slug}${slug === "" ? "" : "/"}${suffix}`);
      },
    },
  };
}
