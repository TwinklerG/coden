import { useState } from "react";
import { messages } from "../../i18n/messages";
import { normalizeRepositoryUrl, type PluginSnapshot } from "../../lib/npm-registry";
import type { Language } from "../../lib/site";

interface Props {
  language: Language;
  packageName: string;
  snapshot: PluginSnapshot | null;
  loading: boolean;
}

export function PluginCard({ language, packageName, snapshot, loading }: Props) {
  const ui = messages[language].marketplace;
  const [copyStatus, setCopyStatus] = useState("");
  const installCommand = `coden plugin install npm:${packageName}`;
  const repoLink = snapshot?.repository ? normalizeRepositoryUrl(snapshot.repository) : undefined;
  const homepageLink = snapshot?.homepage;
  const statusLabel = snapshot?.error
    ? ui.temporarilyUnavailable
    : snapshot?.compatible
      ? ui.compatible
      : snapshot
        ? ui.incompatible
        : ui.loading;
  const downloads =
    typeof snapshot?.downloads === "number"
      ? new Intl.NumberFormat(language).format(snapshot.downloads)
      : undefined;

  async function copyCommand() {
    if (!installCommand) return;
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopyStatus(messages[language].home.install.copied);
    } catch {
      setCopyStatus(messages[language].home.install.failed);
    }
  }

  return (
    <article className="plugin-card">
      <header className="plugin-card-header">
        <div>
          <p className="plugin-card-name">{packageName}</p>
          <p
            className="plugin-card-status"
            role="status"
            aria-label={loading ? ui.loading : undefined}
          >
            {statusLabel}
          </p>
        </div>
        <p className="plugin-card-meta">
          {ui.version}: {snapshot?.version ?? (loading ? ui.loading : "—")}
        </p>
      </header>

      {snapshot?.description ? (
        <p className="plugin-card-description">{snapshot.description}</p>
      ) : null}

      <dl className="plugin-card-details">
        <div>
          <dt>{ui.apiVersion}</dt>
          <dd>{snapshot?.apiVersion ?? "—"}</dd>
        </div>
        <div>
          <dt>{ui.downloads}</dt>
          <dd>{downloads ?? "—"}</dd>
        </div>
      </dl>

      <div className="plugin-card-command">
        <code>{installCommand || `coden plugin install npm:${packageName}`}</code>
        <button type="button" onClick={copyCommand}>
          {ui.copy}
        </button>
      </div>
      <p className="plugin-card-copy-status" aria-live="polite">
        {copyStatus}
      </p>

      <div className="plugin-card-links">
        {homepageLink ? (
          <a href={homepageLink} target="_blank" rel="noreferrer noopener">
            {ui.homepage}
          </a>
        ) : null}
        {repoLink ? (
          <a href={repoLink} target="_blank" rel="noreferrer noopener">
            {ui.repository}
          </a>
        ) : null}
      </div>
    </article>
  );
}
