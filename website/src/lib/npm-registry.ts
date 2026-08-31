import { PLUGIN_CATALOG } from "../data/plugins";

export interface PluginSnapshot {
  packageName: string;
  version?: string;
  description?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  downloads?: number;
  apiVersion?: number;
  compatible: boolean;
  error?: string;
}

export function registryUrls(packageName: string) {
  const encoded = encodeURIComponent(packageName);
  return {
    metadata: `https://registry.npmjs.org/${encoded}/latest`,
    downloads: `https://api.npmjs.org/downloads/point/last-month/${encoded}`,
  };
}

export function normalizeRepositoryUrl(value: unknown): string | undefined {
  const raw =
    typeof value === "string"
      ? value
      : isRecord(value) && typeof value.url === "string"
        ? value.url
        : undefined;

  if (!raw) return undefined;

  const cleaned = raw.replace(/^git\+/, "").replace(/\.git$/, "");
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "https:") return undefined;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadPlugin(
  packageName: string,
  fetcher: FetchLike = fetch,
  timeoutMs = 8000,
): Promise<PluginSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const { metadata, downloads } = registryUrls(packageName);

  try {
    const [metadataResult, downloadsResult] = await Promise.allSettled([
      fetcher(metadata, { signal: controller.signal }),
      fetcher(downloads, { signal: controller.signal }),
    ]);

    const snapshot: PluginSnapshot = {
      packageName,
      compatible: false,
    };

    const metadataResponse =
      metadataResult.status === "fulfilled" && metadataResult.value.ok
        ? metadataResult.value
        : null;
    if (!metadataResponse) {
      snapshot.error =
        metadataResult.status === "rejected"
          ? errorMessage(metadataResult.reason)
          : `Metadata request failed (${metadataResult.value.status})`;
      return snapshot;
    }

    const metadataJson = await parseJson(metadataResponse);
    if (!isRecord(metadataJson)) {
      snapshot.error = "Metadata response was not an object";
      return snapshot;
    }

    const reportedName = stringValue(metadataJson.name);
    if (reportedName !== packageName) {
      snapshot.error = `Registry name mismatch: ${reportedName ?? "unknown"}`;
      return snapshot;
    }

    snapshot.version = stringValue(metadataJson.version);
    snapshot.description = stringValue(metadataJson.description);
    snapshot.license = stringValue(metadataJson.license);
    snapshot.homepage = normalizeHttpsUrl(metadataJson.homepage);
    snapshot.repository = normalizeRepositoryUrl(metadataJson.repository);
    snapshot.apiVersion = apiVersion(metadataJson.coden);
    snapshot.compatible = snapshot.apiVersion === 1;

    if (downloadsResult.status === "fulfilled" && downloadsResult.value.ok) {
      const downloadsJson = (await parseJson(downloadsResult.value)) as
        | { downloads?: unknown }
        | undefined;
      const count = numberValue(downloadsJson?.downloads);
      if (typeof count === "number") {
        snapshot.downloads = count;
      }
    }

    return snapshot;
  } catch (error) {
    return {
      packageName,
      compatible: false,
      error: errorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadCatalog(fetcher: FetchLike = fetch): Promise<PluginSnapshot[]> {
  return Promise.all(PLUGIN_CATALOG.map((entry) => loadPlugin(entry.packageName, fetcher)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function apiVersion(value: unknown): number | undefined {
  return isRecord(value) ? numberValue(value.apiVersion) : undefined;
}

function normalizeHttpsUrl(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw.replace(/^git\+/, ""));
    if (url.protocol !== "https:") return undefined;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
