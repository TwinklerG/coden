import { appendFile, chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import type { EventBus, RuntimeEvent } from "../core/events.js";

export class JSONLTraceWriter {
  #queue = Promise.resolve();
  readonly #pending: RuntimeEvent[] = [];
  constructor(
    private readonly file: string,
    events: EventBus,
    private readonly shouldPersist: () => boolean = () => true,
  ) {
    events.on((event) => this.write(event));
  }
  write(event: RuntimeEvent): Promise<void> {
    if (!this.shouldPersist()) {
      this.#pending.push(event);
      return Promise.resolve();
    }
    const events = [...this.#pending.splice(0), event];
    const operation = this.#queue.then(async () => {
      const directory = path.dirname(this.file);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      await appendFile(this.file, `${events.map((item) => JSON.stringify(item)).join("\n")}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(this.file, 0o600);
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }
  async flush(): Promise<void> {
    await this.#queue;
  }
}
