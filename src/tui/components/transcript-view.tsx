import { Box, Text, useInput } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";
import wrapAnsi from "wrap-ansi";
import type { I18n } from "../../i18n/i18n.js";
import { ACTIVITY_FRAME_INTERVAL_MS } from "../activity.js";
import { parseMouseInputs } from "../mouse.js";
import { renderTranscriptBlock } from "../transcript.js";
import type { TranscriptBlock } from "../types.js";

const OVERSCAN = 4;

export interface TranscriptViewProps {
  blocks: readonly TranscriptBlock[];
  columns: number;
  rows: number;
  followOutput: boolean;
  active: boolean;
  i18n: I18n;
  onFollowChange(follow: boolean): void;
}

export function TranscriptView({
  blocks,
  columns,
  rows,
  followOutput,
  active,
  i18n,
  onFollowChange,
}: TranscriptViewProps) {
  const [activityFrame, setActivityFrame] = useState(0);
  const hasActivity = blocks.some((block) => block.kind === "activity");
  useEffect(() => {
    if (!hasActivity) return;
    const timer = setInterval(
      () => setActivityFrame((value) => value + 1),
      ACTIVITY_FRAME_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [hasActivity]);
  const lines = useMemo(() => {
    const output: Array<{ id: string; text: string }> = [];
    for (const block of blocks) {
      const rendered = renderTranscriptBlock(block, columns, i18n, activityFrame);
      const wrapped = wrapAnsi(rendered || " ", Math.max(1, columns), {
        hard: true,
        trim: false,
        wordWrap: false,
      });
      if (output.length > 0) output.push({ id: `${block.id}-gap`, text: "" });
      let sequence = 0;
      for (const text of wrapped.split("\n")) {
        output.push({ id: `${block.id}-line-${sequence++}`, text });
      }
    }
    return output;
  }, [blocks, columns, i18n, activityFrame]);
  const maximum = Math.max(0, lines.length - Math.max(1, rows));
  const [offset, setOffset] = useState(maximum);

  useEffect(() => {
    setOffset((value) => (followOutput ? maximum : Math.min(value, maximum)));
  }, [followOutput, maximum]);

  const move = useCallback(
    (delta: number) => {
      setOffset((value) => {
        const next = Math.max(0, Math.min(maximum, value + delta));
        onFollowChange(next === maximum);
        return next;
      });
    },
    [maximum, onFollowChange],
  );

  useInput(
    (input, key) => {
      const mouseEvents = parseMouseInputs(input);
      if (mouseEvents) {
        for (const mouse of mouseEvents) {
          if (mouse === "scroll-up") move(-3);
          if (mouse === "scroll-down") move(3);
        }
        return;
      }
      if (key.pageUp) move(-Math.max(1, rows - 1));
      if (key.pageDown) move(Math.max(1, rows - 1));
      if (key.end) {
        setOffset(maximum);
        onFollowChange(true);
      }
    },
    { isActive: active },
  );

  const start = Math.max(0, offset - OVERSCAN);
  const end = Math.min(lines.length, offset + Math.max(1, rows) + OVERSCAN);
  const hiddenBefore = offset - start;
  return (
    <Box height={Math.max(1, rows)} overflow="hidden" flexDirection="column">
      <Box flexDirection="column" marginTop={-hiddenBefore}>
        {lines.slice(start, end).map((line) => (
          <Text key={line.id} wrap="truncate-end">
            {line.text || " "}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
