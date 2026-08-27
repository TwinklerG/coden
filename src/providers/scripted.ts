import type { ModelEvent, ModelProvider, ModelRequest } from "../core/types.js";

export type ScriptStep = ModelEvent[] | Error | ((request: ModelRequest) => ModelEvent[] | Error);
export class ScriptedProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: ScriptStep[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const step = this.steps.shift();
    if (!step) throw new Error("ScriptedProvider exhausted");
    const result = typeof step === "function" ? step(request) : step;
    if (result instanceof Error) throw result;
    for (const event of result) yield event;
  }
}

export function scriptedText(text: string): ModelEvent[] {
  return [{ type: "text_delta", text }, { type: "done" }];
}
export function scriptedTool(callId: string, name: string, input: unknown): ModelEvent[] {
  const json = JSON.stringify(input);
  return [
    { type: "tool_call_start", index: 0, callId, name },
    { type: "tool_call_delta", index: 0, argumentsDelta: json },
    { type: "tool_call_end", index: 0 },
    { type: "done" },
  ];
}
