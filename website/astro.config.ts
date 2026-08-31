import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://twinklerg.github.io",
  base: "/CodeN",
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
        baseUrl: "https://github.com/TwinklerG/CodeN/edit/main/website/",
      },
      customCss: ["./src/styles/global.css"],
      sidebar: [{ autogenerate: { directory: "docs" } }],
      components: {
        SiteTitle: "./src/components/docs/DocsSiteTitle.astro",
      },
      disable404Route: true,
    }),
    mdx(),
  ],
});
