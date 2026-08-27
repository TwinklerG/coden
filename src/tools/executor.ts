import { truncateOutput } from "../context/truncate.js";
import type { EventBus } from "../core/events.js";
import type { ToolCall, ToolResult } from "../core/types.js";
import type { PermissionPolicy } from "../permissions/policy.js";
import { resolveWorkspacePath } from "../permissions/workspace.js";
import type { ToolRegistry } from "./registry.js";

export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private readonly permissions: PermissionPolicy,
    private readonly events: EventBus,
    private readonly workspace: string,
    private readonly timeoutMs = 60_000,
  ) {}
  setRegistry(registry: ToolRegistry): void {
    this.registry = registry;
  }
  async execute(call: ToolCall, signal: AbortSignal, turnId?: string): Promise<ToolResult> {
    await this.events.emit("tool.requested", { name: call.name, callId: call.callId }, turnId);
    const tool = this.registry.get(call.name);
    if (!tool) return { content: `tool.not_found: ${call.name}`, isError: true };
    const validation = this.registry.validate(call.name, call.input);
    if (!validation.valid)
      return { content: `tool.invalid_input: ${validation.errors}`, isError: true };
    if (["read", "write", "edit"].includes(call.name)) {
      try {
        await resolveWorkspacePath(this.workspace, (call.input as { path: string }).path);
      } catch (error) {
        return {
          content: `permission.workspace_denied: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    }
    const permission = await this.permissions.authorize(tool, call, signal);
    await this.events.emit(
      "permission.requested",
      { name: call.name, callId: call.callId, risk: permission.risk, allowed: permission.allowed },
      turnId,
    );
    if (!permission.allowed)
      return { content: `permission.denied: ${call.name} was not authorized`, isError: true };
    await this.events.emit("tool.started", { name: call.name, callId: call.callId }, turnId);
    const start = Date.now();
    let result: ToolResult;
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal.reason);
    if (signal.aborted) relayAbort();
    else signal.addEventListener("abort", relayAbort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error(`Tool timed out after ${this.timeoutMs}ms`)),
      this.timeoutMs,
    );
    try {
      const aborted = controller.signal.aborted
        ? Promise.reject(controller.signal.reason)
        : new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
              once: true,
            });
          });
      result = await Promise.race([
        tool.execute(call.input, { workspace: this.workspace, signal: controller.signal }),
        aborted,
      ]);
      result = { ...result, content: truncateOutput(result.content, 50_000) };
    } catch (error) {
      const timedOut = !signal.aborted && controller.signal.aborted;
      result = {
        content: `${timedOut ? "tool.timeout (abort requested; tools must cooperate)" : "tool.internal_error"}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", relayAbort);
    }
    await this.events.emit(
      "tool.completed",
      {
        name: call.name,
        callId: call.callId,
        isError: result.isError ?? false,
        durationMs: Date.now() - start,
      },
      turnId,
    );
    return result;
  }
}
