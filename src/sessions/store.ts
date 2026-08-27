import { createHash, randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentMessage } from "../core/types.js";

interface SessionRecord {
  version: 1;
  id: string;
  timestamp: string;
  type: string;
  data: unknown;
}
export interface RecoveredSession {
  messages: AgentMessage[];
  summary?: string;
  compactionRange?: { start: number; end: number };
  warnings: string[];
}

export function workspaceHash(workspace: string): string {
  return createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 16);
}
export class SessionStore {
  readonly sessionPath: string;
  readonly tracePath: string;
  #queue = Promise.resolve();
  constructor(
    dataDir: string,
    workspace: string,
    readonly sessionId: string = randomUUID(),
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId))
      throw new Error("Invalid session ID");
    const directory = path.join(dataDir, "sessions", workspaceHash(workspace));
    this.sessionPath = path.join(directory, `${sessionId}.jsonl`);
    this.tracePath = path.join(directory, `${sessionId}.trace.jsonl`);
  }
  async create(workspace: string): Promise<void> {
    await this.append("session.created", { workspace, sessionId: this.sessionId });
  }
  append(type: string, data: unknown): Promise<void> {
    const record: SessionRecord = {
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      data,
    };
    const operation = this.#queue.then(async () => {
      const directory = path.dirname(this.sessionPath);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      await appendFile(this.sessionPath, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(this.sessionPath, 0o600);
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }
  appendMessage(message: AgentMessage): Promise<void> {
    return this.append("message", message);
  }
  appendCompaction(summary: string, sourceRange?: { start: number; end: number }): Promise<void> {
    return this.append("context.compacted", sourceRange ? { summary, sourceRange } : { summary });
  }
  async recover(): Promise<RecoveredSession> {
    const messages: AgentMessage[] = [];
    const warnings: string[] = [];
    let summary: string | undefined;
    let compactionRange: { start: number; end: number } | undefined;
    const text = await readFile(this.sessionPath, "utf8");
    const lines = text.split("\n");
    let lastRecordIndex = -1;
    for (let index = lines.length - 1; index >= 0; index--) {
      if (lines[index]) {
        lastRecordIndex = index;
        break;
      }
    }
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line) continue;
      let record: SessionRecord;
      try {
        record = JSON.parse(line) as SessionRecord;
      } catch (error) {
        if (index === lastRecordIndex) {
          warnings.push("Ignored incomplete final JSONL record");
          break;
        }
        throw invalidRecord(index, error);
      }
      try {
        if (record.version !== 1) throw new Error("unsupported schema version");
        if (record.type === "session.reset") {
          messages.length = 0;
          summary = undefined;
          compactionRange = undefined;
        }
        if (record.type === "message") {
          if (!isMessage(record.data)) throw new Error("invalid message structure");
          messages.push(record.data);
        }
        if (record.type === "context.compacted") {
          const data = record.data as {
            summary?: unknown;
            sourceRange?: { start?: unknown; end?: unknown };
          };
          if (typeof data?.summary !== "string") throw new Error("invalid compaction record");
          summary = data.summary;
          compactionRange =
            typeof data.sourceRange?.start === "number" && typeof data.sourceRange.end === "number"
              ? { start: data.sourceRange.start, end: data.sourceRange.end }
              : undefined;
        }
      } catch (error) {
        throw invalidRecord(index, error);
      }
    }
    const repairs = repairTrailingToolCalls(messages, warnings);
    for (const repair of repairs) await this.appendMessage(repair);
    const recovered: RecoveredSession = { messages, warnings };
    if (summary !== undefined) recovered.summary = summary;
    if (compactionRange !== undefined) recovered.compactionRange = compactionRange;
    return recovered;
  }
}
function isMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if ((message.role === "system" || message.role === "user") && typeof message.content === "string")
    return true;
  if (message.role === "assistant" && typeof message.content === "string") {
    return (
      Array.isArray(message.toolCalls) &&
      message.toolCalls.every(
        (call) =>
          !!call &&
          typeof call === "object" &&
          typeof (call as Record<string, unknown>).callId === "string" &&
          typeof (call as Record<string, unknown>).name === "string" &&
          "input" in (call as Record<string, unknown>),
      )
    );
  }
  return (
    message.role === "tool" &&
    typeof message.callId === "string" &&
    typeof message.name === "string" &&
    typeof message.content === "string" &&
    typeof message.isError === "boolean"
  );
}
function invalidRecord(index: number, error: unknown): Error {
  return new Error(
    `Invalid session record at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

function repairTrailingToolCalls(messages: AgentMessage[], warnings: string[]): AgentMessage[] {
  const pending = new Map<string, string>();
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      if (pending.size > 0)
        throw new Error("Assistant message appeared before pending tool results");
      for (const call of message.toolCalls) {
        if (seen.has(call.callId)) throw new Error(`Duplicate tool call ID: ${call.callId}`);
        seen.add(call.callId);
        pending.set(call.callId, call.name);
      }
    } else if (message.role === "tool") {
      if (!pending.delete(message.callId)) throw new Error(`Orphan tool result: ${message.callId}`);
    } else if (pending.size > 0) {
      throw new Error(`${message.role} message appeared before pending tool results`);
    }
  }
  if (pending.size === 0) return [];
  const repairs: AgentMessage[] = [];
  for (const [callId, name] of pending) {
    const repair: AgentMessage = {
      role: "tool",
      callId,
      name,
      content:
        "runtime.interrupted: tool execution did not complete before the previous process exited",
      isError: true,
    };
    messages.push(repair);
    repairs.push(repair);
  }
  warnings.push(`Recovered ${pending.size} interrupted tool call(s)`);
  return repairs;
}
