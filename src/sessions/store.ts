import { createHash, randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, readdir, readFile } from "node:fs/promises";
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
export interface SessionMeta {
  id: string;
  title?: string;
  messageCount: number;
  lastActivity: string;
}

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

export function workspaceHash(workspace: string): string {
  return createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 16);
}
export class SessionStore {
  readonly sessionPath: string;
  readonly tracePath: string;
  #queue = Promise.resolve();
  #created = false;
  constructor(
    dataDir: string,
    private readonly workspace: string,
    readonly sessionId: string = randomUUID(),
  ) {
    if (!isValidSessionId(sessionId)) throw new Error("Invalid session ID");
    const directory = path.join(dataDir, "sessions", workspaceHash(workspace));
    this.sessionPath = path.join(directory, `${sessionId}.jsonl`);
    this.tracePath = path.join(directory, `${sessionId}.trace.jsonl`);
  }
  get isCreated(): boolean {
    return this.#created;
  }
  async create(workspace = this.workspace): Promise<void> {
    if (this.#created) return;
    await this.append("session.created", { workspace, sessionId: this.sessionId });
    this.#created = true;
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
  setTitle(title: string): Promise<void> {
    return this.append("session.title", { title });
  }

  async list(): Promise<SessionMeta[]> {
    const directory = path.dirname(this.sessionPath);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const metas: SessionMeta[] = [];
    for (const name of names) {
      // 会话文件形如 <id>.jsonl；trace 文件形如 <id>.trace.jsonl（同样以 .jsonl 结尾），须排除。
      if (!name.endsWith(".jsonl") || name.endsWith(".trace.jsonl")) continue;
      const id = name.slice(0, -".jsonl".length);
      if (!isValidSessionId(id)) continue;
      try {
        metas.push(await this.#readMeta(path.join(directory, name), id));
      } catch {
        // Skip a session file that cannot be parsed.
      }
    }
    metas.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    return metas;
  }

  async #readMeta(filePath: string, id: string): Promise<SessionMeta> {
    const text = await readFile(filePath, "utf8");
    let messageCount = 0;
    let title: string | undefined;
    let firstUserPrompt: string | undefined;
    let lastActivity = "";
    for (const line of text.split("\n")) {
      if (!line) continue;
      let record: SessionRecord;
      try {
        record = JSON.parse(line) as SessionRecord;
      } catch {
        continue;
      }
      if (record.version !== 1) continue;
      if (record.timestamp) lastActivity = record.timestamp;
      switch (record.type) {
        case "session.reset":
          messageCount = 0;
          firstUserPrompt = undefined;
          title = undefined;
          break;
        case "session.title": {
          const data = record.data as { title?: unknown };
          if (typeof data?.title === "string") title = data.title;
          break;
        }
        case "message":
          messageCount++;
          if (firstUserPrompt === undefined) {
            const data = record.data as { role?: unknown; content?: unknown };
            if (data?.role === "user" && typeof data.content === "string") {
              firstUserPrompt = data.content;
            }
          }
          break;
      }
    }
    const resolvedTitle = title ?? firstUserPrompt;
    const meta: SessionMeta = { id, messageCount, lastActivity };
    if (resolvedTitle !== undefined) meta.title = resolvedTitle;
    return meta;
  }
  async recover(): Promise<RecoveredSession> {
    const messages: AgentMessage[] = [];
    const warnings: string[] = [];
    let summary: string | undefined;
    let compactionRange: { start: number; end: number } | undefined;
    const text = await readFile(this.sessionPath, "utf8");
    this.#created = true;
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
