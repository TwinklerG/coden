import type { APIRoute } from "astro";
import { BASE_PATH, SITE_ORIGIN } from "../lib/site";

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(
    `User-agent: *\nAllow: ${BASE_PATH}/\nSitemap: ${SITE_ORIGIN}${BASE_PATH}/sitemap-index.xml\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
