import { defineCollection } from "astro:content";
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // Starlight looks for this collection to load UI-string overrides from and
  // warns on every build when it is absent. Declaring it changes no behavior --
  // the site is English-only and there are no overrides -- and is what
  // Starlight's own recommended config contains (#339).
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
