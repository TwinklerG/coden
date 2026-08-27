import { appendFile, chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import type { EventBus, RuntimeEvent } from "../core/events.js";

export class JSONLTraceWriter {
  #queue = Promise.resolve();
  constructor(
    private readonly file: string,
    events: EventBus,
  ) {
    events.on((event) => this.write(event));
  }
  write(event: RuntimeEvent): Promise<void> {
    const operation = this.#queue.then(async () => {
      const directory = path.dirname(this.file);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      await appendFile(this.file, `${JSON.stringify(event)}\n`, {
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
