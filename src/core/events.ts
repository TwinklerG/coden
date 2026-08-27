import type { Usage } from "./types.js";

export type RuntimeEvent = {
  type: string;
  timestamp: string;
  turnId?: string;
  data?: Record<string, unknown>;
};

export type EventListener = (event: RuntimeEvent) => void | Promise<void>;

export class EventBus {
  readonly #listeners = new Set<EventListener>();
  on(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  async emit(type: string, data?: Record<string, unknown>, turnId?: string): Promise<RuntimeEvent> {
    const event: RuntimeEvent = { type, timestamp: new Date().toISOString() };
    if (turnId !== undefined) event.turnId = turnId;
    if (data !== undefined) event.data = data;
    await Promise.all([...this.#listeners].map((listener) => listener(event)));
    return event;
  }
}

export interface TurnMetrics {
  tools: number;
  durationMs: number;
  usage: Usage;
  contextTokens: number;
}
