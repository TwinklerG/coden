import { Box, Text, useInput } from "ink";
import { I18n } from "../../i18n/i18n.js";
import type { PermissionDecision } from "../../permissions/policy.js";
import type { TuiDialog } from "../types.js";

function keyedLines(dialog: Extract<TuiDialog, { kind: "permission" }>) {
  const occurrences = new Map<string, number>();
  return dialog.lines.map((text) => {
    const occurrence = (occurrences.get(text) ?? 0) + 1;
    occurrences.set(text, occurrence);
    return { id: `${dialog.id}-${text}-${occurrence}`, text };
  });
}

export function PermissionDialog({
  dialog,
  onResolve,
  i18n = new I18n("en"),
}: {
  dialog: TuiDialog;
  onResolve(decision: PermissionDecision | boolean): void;
  i18n?: I18n;
}) {
  useInput((input) => {
    const answer = input.toLowerCase();
    if (dialog.kind === "confirm") {
      if (answer === "y") onResolve(true);
      if (answer === "n" || input === "\u001b") onResolve(false);
      return;
    }
    if (answer === "y") onResolve("allow_once");
    if (answer === "s" && dialog.allowSession) onResolve("allow_session");
    if (answer === "n" || input === "\u001b") onResolve("deny");
  });

  return (
    <Box
      width="80%"
      alignSelf="center"
      flexDirection="column"
      borderStyle="single"
      borderColor={dialog.kind === "permission" && dialog.risk === "dangerous" ? "red" : "yellow"}
      paddingX={1}
    >
      {dialog.kind === "confirm" ? (
        <>
          <Text>{dialog.message}</Text>
          <Text dimColor>
            {i18n.currentLanguage === "zh" ? "[y] 是 · [n] 否" : "[y] yes · [n] no"}
          </Text>
        </>
      ) : (
        <>
          <Text bold>{dialog.title}</Text>
          {keyedLines(dialog).map((line) => (
            <Text key={line.id}>{line.text}</Text>
          ))}
          <Text dimColor>
            {i18n.currentLanguage === "zh"
              ? dialog.allowSession
                ? "[y] 允许一次 · [s] 本会话 · [n] 拒绝"
                : "[y] 允许 · [n] 拒绝"
              : dialog.allowSession
                ? "[y] once · [s] session · [n] deny"
                : "[y] allow · [n] deny"}
          </Text>
        </>
      )}
    </Box>
  );
}
