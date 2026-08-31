import type { KeyboardEvent } from "react";
import { useRef, useState } from "react";
import { HOME_CONTENT } from "../../data/home";
import { messages } from "../../i18n/messages";
import type { Language } from "../../lib/site";

interface Props {
  language: Language;
}

type TabKey = "cli" | "tui";

export function TerminalDemo({ language }: Props) {
  const copyMessages = messages[language].home.terminal;
  const content = HOME_CONTENT[language].terminal;
  const [active, setActive] = useState<TabKey>("cli");
  const cliTabRef = useRef<HTMLButtonElement>(null);
  const tuiTabRef = useRef<HTMLButtonElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = active === "cli" ? "tui" : "cli";
    setActive(next);
    (next === "cli" ? cliTabRef : tuiTabRef).current?.focus();
  }

  const panel = active === "cli" ? content.cli : content.tui;

  return (
    <section className="terminal-demo" aria-label="Terminal preview">
      <div
        className="terminal-tabs"
        role="tablist"
        aria-label="Terminal mode"
        onKeyDown={handleKeyDown}
      >
        {(
          [
            ["cli", copyMessages.cliLabel],
            ["tui", copyMessages.tuiLabel],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            ref={key === "cli" ? cliTabRef : tuiTabRef}
            type="button"
            role="tab"
            aria-selected={active === key}
            tabIndex={active === key ? 0 : -1}
            aria-controls={`terminal-panel-${key}`}
            id={`terminal-tab-${key}`}
            className="terminal-tab"
            onClick={() => setActive(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="terminal-window">
        <div
          id={`terminal-panel-${active}`}
          role="tabpanel"
          aria-labelledby={`terminal-tab-${active}`}
          className={`terminal-panel terminal-panel--${active}`}
        >
          <h3 className="terminal-panel-title">{panel.title}</h3>
          {active === "cli" ? (
            <pre className="terminal-panel-pre">{panel.lines.join("\n")}</pre>
          ) : (
            <div className="terminal-tui">
              <div className="terminal-tui-grid">
                {panel.lines.map((line) => {
                  const [label, value] = line.split(": ");
                  return (
                    <div key={line} className="terminal-tui-row">
                      <span className="terminal-tui-label">{label}</span>
                      <span className="terminal-tui-value">{value}</span>
                    </div>
                  );
                })}
              </div>
              <fieldset className="terminal-tui-input" aria-label={copyMessages.inputLabel}>
                <span>&gt;</span>
                <span className="terminal-tui-cursor">_</span>
              </fieldset>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
