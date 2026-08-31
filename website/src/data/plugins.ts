export interface PluginCatalogEntry {
  packageName: string;
  featured: boolean;
  category: string;
  order: number;
}

export const PLUGIN_CATALOG = [
  { packageName: "coden-modern-unix", featured: true, category: "developer-tools", order: 10 },
  { packageName: "coden-msb", featured: true, category: "sandbox", order: 20 },
] as const satisfies readonly PluginCatalogEntry[];
