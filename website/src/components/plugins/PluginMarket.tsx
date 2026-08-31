import { useEffect, useMemo, useState } from "react";
import { PLUGIN_CATALOG } from "../../data/plugins";
import { messages } from "../../i18n/messages";
import { loadPlugin, type PluginSnapshot } from "../../lib/npm-registry";
import type { Language } from "../../lib/site";
import { PluginCard } from "./PluginCard";

interface Props {
  language: Language;
  loader?: (packageName: string) => Promise<PluginSnapshot>;
}

export function PluginMarket({ language, loader = loadPlugin }: Props) {
  const ui = messages[language].marketplace;
  const [query, setQuery] = useState("");
  const [snapshots, setSnapshots] = useState<Record<string, PluginSnapshot | null>>(() =>
    Object.fromEntries(PLUGIN_CATALOG.map((entry) => [entry.packageName, null])),
  );

  useEffect(() => {
    let active = true;
    for (const entry of PLUGIN_CATALOG) {
      loader(entry.packageName)
        .then((snapshot) => {
          if (!active) return;
          setSnapshots((current) => ({ ...current, [entry.packageName]: snapshot }));
        })
        .catch((error) => {
          if (!active) return;
          setSnapshots((current) => ({
            ...current,
            [entry.packageName]: {
              packageName: entry.packageName,
              compatible: false,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        });
    }

    return () => {
      active = false;
    };
  }, [loader]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return PLUGIN_CATALOG.filter((entry) => {
      if (!normalizedQuery) return true;
      const snapshot = snapshots[entry.packageName];
      const haystack = [entry.packageName, snapshot?.description ?? "", snapshot?.version ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, snapshots]);

  const loading = Object.values(snapshots).some((snapshot) => snapshot === null);

  return (
    <section className="plugin-market">
      <div className="plugin-market-header">
        <div>
          <p className="plugin-market-kicker">{ui.title}</p>
          <p className="plugin-market-description">{ui.description}</p>
        </div>
        <label className="plugin-market-search">
          <span className="sr-only">{ui.searchPlaceholder}</span>
          <input
            type="search"
            placeholder={ui.searchPlaceholder}
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </div>

      <p className="plugin-market-notice">{ui.notice}</p>

      <div className="plugin-market-grid" aria-busy={loading ? "true" : "false"}>
        {filteredEntries.map((entry) => (
          <PluginCard
            key={entry.packageName}
            packageName={entry.packageName}
            language={language}
            loading={snapshots[entry.packageName] === null}
            snapshot={snapshots[entry.packageName]}
          />
        ))}
      </div>

      {!loading && filteredEntries.length === 0 ? (
        <p className="plugin-market-empty">{ui.noResults}</p>
      ) : null}
    </section>
  );
}
