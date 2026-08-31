import type { RenderOptions } from "ink";
import { Box, render, useInput, useWindowSize } from "ink";
import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import type { AgentCommandOptions } from "../cli/agent-command.js";
import { EditorState } from "../cli/editor-state.js";
import type { I18n } from "../i18n/i18n.js";
import { calculateInputBarLayout, InputBar } from "./components/input-bar.js";
import { StatusBar } from "./components/status-bar.js";
import { TranscriptView } from "./components/transcript-view.js";
import { TuiController } from "./controller.js";
import { useMouseReporting } from "./mouse.js";
import { TuiStore } from "./store.js";

export class TuiInitializationError extends Error {}

export const TUI_RENDER_OPTIONS = {
  alternateScreen: true,
  exitOnCtrlC: false,
  patchConsole: false,
  kittyKeyboard: {
    mode: "auto",
    flags: ["disambiguateEscapeCodes"],
  },
} satisfies RenderOptions;

export function calculateTranscriptRows(terminalRows: number, inputRows: number): number {
  // Two input rules plus one status row.
  return Math.max(1, terminalRows - Math.max(1, inputRows) - 3);
}

export function calculateInputCursorTopRow(transcriptRows: number): number {
  return transcriptRows + 1;
}

export function TuiApp({
  controller,
  store,
  i18n,
}: {
  controller: TuiController;
  store: TuiStore;
  i18n: I18n;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { columns, rows } = useWindowSize();
  const editor = useRef(new EditorState()).current;
  const [, reviseEditor] = useReducer((value: number) => value + 1, 0);
  const inputLayout = calculateInputBarLayout(
    editor.text,
    editor.cursor,
    i18n.currentLanguage,
    columns,
  );
  const transcriptRows = calculateTranscriptRows(rows, inputLayout.editor.rows.length);
  const pendingInteraction = snapshot.pendingInteraction;
  useMouseReporting();

  useEffect(() => {
    void controller.bootstrap();
    const terminate = () => void controller.shutdown();
    process.on("SIGTERM", terminate);
    process.on("SIGHUP", terminate);
    return () => {
      process.removeListener("SIGTERM", terminate);
      process.removeListener("SIGHUP", terminate);
      void controller.dispose();
    };
  }, [controller]);

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        void controller.requestExit();
        return;
      }
      if (key.escape) {
        store.resolveInteraction("n");
        return;
      }
      const answer = input.toLowerCase();
      if (answer === "y" || answer === "n") store.resolveInteraction(answer);
      if (answer === "s" && pendingInteraction?.kind === "permission") {
        store.resolveInteraction("s");
      }
    },
    { isActive: Boolean(pendingInteraction) },
  );

  return (
    <Box width={columns} height={rows} flexDirection="column" position="relative">
      <TranscriptView
        blocks={snapshot.blocks}
        columns={columns}
        rows={transcriptRows}
        followOutput={snapshot.followOutput}
        active={true}
        i18n={i18n}
        onFollowChange={(follow) => store.setFollowOutput(follow)}
      />
      <InputBar
        state={editor}
        layout={inputLayout}
        disabled={snapshot.running || Boolean(pendingInteraction)}
        active={!pendingInteraction}
        language={i18n.currentLanguage}
        columns={columns}
        topRow={calculateInputCursorTopRow(transcriptRows)}
        onSubmit={(text) => void controller.submit(text)}
        onEof={() => void controller.shutdown()}
        onInterrupt={() => void controller.requestExit()}
        onEditorChange={() => reviseEditor()}
      />
      <StatusBar
        metadata={snapshot.metadata}
        phase={snapshot.phase}
        contextPercent={snapshot.contextPercent}
        columns={columns}
        {...(snapshot.turnUsage ? { usage: snapshot.turnUsage } : {})}
        phaseLabel={i18n.messages.tui.phases[snapshot.phase]}
      />
    </Box>
  );
}

export async function runTuiCommand(
  initialPrompt: string | undefined,
  command: AgentCommandOptions,
  i18n: I18n,
): Promise<void> {
  const store = new TuiStore(i18n);
  let instance: ReturnType<typeof render> | undefined;
  const controller = new TuiController({
    ...(initialPrompt ? { initialPrompt } : {}),
    command,
    i18n,
    store,
    onExit: () => instance?.unmount(),
  });
  try {
    instance = render(
      <TuiApp controller={controller} store={store} i18n={i18n} />,
      TUI_RENDER_OPTIONS,
    );
  } catch (cause) {
    await controller.dispose();
    throw new TuiInitializationError(
      `unable to initialize Ink: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  await instance.waitUntilExit();
  await controller.dispose();
  const fatal = store.getSnapshot().fatalError;
  if (fatal) process.stderr.write(`${i18n.messages.tui.fatal(fatal)}\n`);
}
