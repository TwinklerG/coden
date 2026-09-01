import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

export interface WebStaticAsset {
  filePath: string;
  contentType: string;
  cacheControl: string;
}

export type WebStaticAssets = ReadonlyMap<string, WebStaticAsset>;

export async function loadStaticAssets(root: string): Promise<WebStaticAssets> {
  const assets = new Map<string, WebStaticAsset>();
  await walk(root, "", assets);
  const index = assets.get("/index.html");
  if (!index) throw new Error(`Web assets are missing index.html in ${root}`);
  assets.set("/", index);
  return assets;
}

export function resolveStaticAsset(
  assets: WebStaticAssets,
  pathname: string,
): WebStaticAsset | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0") || decoded.split("/").includes("..")) return undefined;
  return assets.get(decoded);
}

async function walk(root: string, relative: string, assets: Map<string, WebStaticAsset>) {
  const directory = path.join(root, relative);
  for (const entry of await readdir(directory)) {
    const relativePath = path.join(relative, entry);
    const filePath = path.join(root, relativePath);
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      await walk(root, relativePath, assets);
      continue;
    }
    if (!stat.isFile()) continue;
    const urlPath = `/${relativePath.split(path.sep).join("/")}`;
    assets.set(urlPath, {
      filePath,
      contentType: contentType(filePath),
      cacheControl:
        path.basename(filePath).includes("-") && !filePath.endsWith(".html")
          ? "public, max-age=31536000, immutable"
          : "no-store",
    });
  }
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}
