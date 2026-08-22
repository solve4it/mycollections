import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { satteri } from "@astrojs/markdown-satteri";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { satteriRelativeDocLinks } from "./scripts/satteri-relative-doc-links.mjs";
import { BASE, SITE } from "./site.mjs";

const CONTENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "src/content/docs");

export default defineConfig({
  site: SITE,
  base: BASE,
  markdown: {
    // `satteri()` is the default processor; naming it here only adds the plugin.
    // The shared docs in `docs/` link to each other the way GitHub needs, and
    // this turns those links into site URLs.
    processor: satteri({ hastPlugins: [satteriRelativeDocLinks({ base: BASE, contentRoot: CONTENT_ROOT })] }),
  },
  integrations: [
    starlight({
      title: "MyCollections",
      description: "Local-first personal collection management with a plugin architecture.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/solve4it/mycollections",
        },
      ],
      sidebar: [
        {
          label: "User Guide",
          items: [
            { label: "Welcome", slug: "user" },
            { label: "Getting Started", slug: "user/getting-started" },
            { label: "Collections", slug: "user/collections" },
            { label: "Items", slug: "user/items" },
            { label: "Search", slug: "user/search" },
            { label: "Settings", slug: "user/settings" },
          ],
        },
        {
          label: "Project",
          items: [
            {
              label: "Contributing",
              link: "https://github.com/solve4it/mycollections/blob/main/CONTRIBUTING.md",
            },
            {
              label: "Development",
              link: "https://github.com/solve4it/mycollections/blob/main/DEVELOPMENT.md",
            },
          ],
        },
      ],
    }),
  ],
});
