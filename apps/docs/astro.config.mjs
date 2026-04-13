import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://solve4it.github.io",
  base: "/mycollections",
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
