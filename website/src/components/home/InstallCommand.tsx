import { useMemo, useState } from "react";
import { messages } from "../../i18n/messages";
import type { Language } from "../../lib/site";

const COMMANDS = {
  bun: "bun add -g @twinklerg/coden",
  npm: "npm install -g @twinklerg/coden",
} as const;

type PackageManager = keyof typeof COMMANDS;

interface Props {
  language: Language;
}

export function InstallCommand({ language }: Props) {
  const copyMessages = messages[language].home.install;
  const [manager, setManager] = useState<PackageManager>("bun");
  const [status, setStatus] = useState(copyMessages.helper);
  const command = useMemo(() => COMMANDS[manager], [manager]);
  const tabLabels = {
    bun: copyMessages.bunLabel,
    npm: copyMessages.npmLabel,
  } as const;

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setStatus(copyMessages.copied);
    } catch {
      setStatus(copyMessages.failed);
    }
  }

  return (
    <section className="install-command" aria-label={copyMessages.helper}>
      <div className="install-command-tabs" role="tablist" aria-label="Install method">
        {(Object.keys(COMMANDS) as PackageManager[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={manager === key}
            className="install-command-tab"
            onClick={() => {
              setManager(key);
              setStatus(copyMessages.helper);
            }}
          >
            {tabLabels[key]} {key === "npm" && "(limited support for plugin tools)"}
          </button>
        ))}
      </div>

      <div className="install-command-row">
        <code className="install-command-code">{command}</code>
        <button type="button" className="install-command-copy" onClick={copyCommand}>
          {copyMessages.copy}
        </button>
      </div>

      <p className="install-command-status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
