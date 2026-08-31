import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { BASE_PATH, REPOSITORY_EDIT_URL, SITE_ORIGIN } from "./src/lib/site";

export default defineConfig({
  site: SITE_ORIGIN,
  base: BASE_PATH,
  output: "static",
  trailingSlash: "always",
  integrations: [
    react(),
    sitemap(),
    starlight({
      title: "CodeN",
      description: "CodeN product website and documentation",
      defaultLocale: "zh",
      locales: {
        zh: { label: "简体中文", lang: "zh-CN" },
        en: { label: "English", lang: "en" },
      },
      editLink: {
        baseUrl: REPOSITORY_EDIT_URL,
      },
      customCss: ["./src/styles/global.css", "./src/styles/docs.css"],
      sidebar: [{ autogenerate: { directory: "docs" } }],
      components: {
        SiteTitle: "./src/components/docs/DocsSiteTitle.astro",
      },
      disable404Route: true,
    }),
    mdx(),
  ],
});
