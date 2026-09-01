import { useEffect, useMemo, useState } from "react";
import {
  WEB_PROTOCOL_VERSION,
  type WebInteractionDecision,
  type WebStateResponse,
} from "../../web/protocol.js";
import {
  CodeNWebApi,
  connectStateStream,
  type StateStreamHandle,
  type StateStreamOptions,
} from "./api.js";
import { Composer } from "./components/composer.js";
import { SessionSidebar } from "./components/session-sidebar.js";
import { StatusHeader } from "./components/status-header.js";
import { Transcript } from "./components/transcript.js";
import { messagesFor } from "./i18n.js";

export interface AppProps {
  api?: CodeNWebApi;
  connect?: (options: StateStreamOptions) => StateStreamHandle;
}

export function App({
  api: suppliedApi,
  connect = connectStateStream,
}: AppProps) {
  const api = useMemo(() => suppliedApi ?? new CodeNWebApi(), [suppliedApi]);
  const [state, setState] = useState<WebStateResponse>();
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");
  const [actionError, setActionError] = useState<string>();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const handle = connect({
      api,
      onState(next) {
        document.documentElement.lang = next.snapshot.language;
        setState(next);
        setActionError(undefined);
      },
      onStatus: setConnection,
      onError: (error) => setActionError(error.message),
    });
    return () => handle.dispose();
  }, [api, connect]);

  const perform = async (action: () => Promise<void>) => {
    setActionError(undefined);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  if (!state) {
    return (
      <main className="boot-screen">
        <code>~/ coden --web</code>
        <span>
          {connection === "reconnecting" ? "reconnecting" : "starting"}
        </span>
        {actionError && <p role="alert">{actionError}</p>}
      </main>
    );
  }

  if (state.protocolVersion !== WEB_PROTOCOL_VERSION) {
    return (
      <main className="boot-screen" role="alert">
        <code>web.protocol_mismatch</code>
        <span>Restart CodeN and refresh this page.</span>
      </main>
    );
  }

  const { snapshot, viewer } = state;
  const messages = messagesFor(snapshot.language);
  const isOwner = snapshot.control.ownerClientId === viewer.clientId;
  const ready = snapshot.phase !== "starting" && snapshot.phase !== "failed";
  const canControl = isOwner && ready;

  return (
    <div className="app-shell">
      <SessionSidebar
        sessions={snapshot.sessions}
        {...(snapshot.sessionId ? { currentId: snapshot.sessionId } : {})}
        messages={messages}
        running={snapshot.running || snapshot.phase === "starting"}
        isOwner={isOwner}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNew={() => void perform(() => api.newSession())}
        onResume={(id) => {
          setDrawerOpen(false);
          void perform(() => api.resumeSession(id));
        }}
      />
      <main className="agent-pane">
        <StatusHeader
          snapshot={snapshot}
          messages={messages}
          connection={connection}
          isOwner={isOwner}
          onTakeover={() => void perform(() => api.takeover())}
          onOpenSessions={() => setDrawerOpen(true)}
        />
        {snapshot.remote && (
          <div className="remote-warning">{messages.noTls}</div>
        )}
        {snapshot.startupWarnings.length > 0 && (
          <div className="startup-warnings">
            {snapshot.startupWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
        {snapshot.fatalError && (
          <section className="fatal-panel" role="alert">
            <code>{snapshot.fatalError.code}</code>
            <p>{snapshot.fatalError.message}</p>
          </section>
        )}
        <Transcript
          blocks={snapshot.blocks}
          messages={messages}
          phase={snapshot.phase}
          interactionEnabled={canControl}
          {...(actionError ? { actionError } : {})}
          onInteraction={(id: string, decision: WebInteractionDecision) =>
            void perform(() => api.answerInteraction(id, decision))
          }
        />
        <Composer
          messages={messages}
          running={snapshot.running}
          enabled={canControl}
          onSubmit={(text) => void perform(() => api.submit(text))}
          onCancel={() => void perform(() => api.cancel())}
        />
      </main>
    </div>
  );
}
