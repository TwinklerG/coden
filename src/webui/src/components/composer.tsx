import { type KeyboardEvent, useState } from "react";
import type { WebMessages } from "../i18n.js";

export function Composer({
  messages,
  running,
  enabled,
  onSubmit,
  onCancel,
}: {
  messages: WebMessages;
  running: boolean;
  enabled: boolean;
  onSubmit(text: string): void;
  onCancel(): void;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!enabled || running || !text.trim()) return;
    onSubmit(text);
    setText("");
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    submit();
  };
  return (
    <div className="composer-shell">
      <label htmlFor="agent-prompt" className="sr-only">
        {messages.prompt}
      </label>
      <textarea
        id="agent-prompt"
        value={text}
        rows={3}
        placeholder={enabled ? messages.prompt : messages.readOnly}
        disabled={!enabled || running}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={keyDown}
      />
      <div className="composer-actions">
        <span className="composer-hint">Enter ↵ · Shift+Enter ⏎</span>
        {running ? (
          <button
            className="button-danger"
            type="button"
            disabled={!enabled}
            onClick={onCancel}
          >
            <span aria-hidden="true">■</span> {messages.cancel}
          </button>
        ) : (
          <button
            type="button"
            disabled={!enabled || !text.trim()}
            onClick={submit}
          >
            {messages.send} <span aria-hidden="true">↵</span>
          </button>
        )}
      </div>
    </div>
  );
}
