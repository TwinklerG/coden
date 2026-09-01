import type {
  WebApiError,
  WebInteractionDecision,
  WebStateResponse,
} from "../../web/protocol.js";
import { applyEnvelope, WebRevisionGapError } from "./state.js";

export class WebRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(message);
    this.name = "WebRequestError";
  }
}

export class CodeNWebApi {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  takeover(): Promise<void> {
    return this.action("/api/control/takeover", {});
  }
  submit(text: string): Promise<void> {
    return this.action("/api/turn", { text });
  }
  cancel(): Promise<void> {
    return this.action("/api/cancel", {});
  }
  answerInteraction(
    id: string,
    decision: WebInteractionDecision,
  ): Promise<void> {
    return this.action(`/api/interactions/${encodeURIComponent(id)}`, {
      decision,
    });
  }
  newSession(): Promise<void> {
    return this.action("/api/sessions/new", {});
  }
  resumeSession(sessionId: string): Promise<void> {
    return this.action("/api/sessions/resume", { sessionId });
  }
  async state(signal?: AbortSignal): Promise<WebStateResponse> {
    const response = await this.fetcher("/api/state", {
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    });
    return parseResponse<WebStateResponse>(response);
  }

  private async action(url: string, body: unknown): Promise<void> {
    const response = await this.fetcher(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await parseResponse<void>(response);
  }
}

export interface StateStreamOptions {
  api?: CodeNWebApi;
  eventSource?: (url: string) => EventSource;
  onState(state: WebStateResponse): void;
  onStatus(status: "connecting" | "connected" | "reconnecting"): void;
  onError(error: Error): void;
}

export interface StateStreamHandle {
  dispose(): void;
}

export function connectStateStream(
  options: StateStreamOptions,
): StateStreamHandle {
  const api = options.api ?? new CodeNWebApi();
  const createSource = options.eventSource ?? ((url) => new EventSource(url));
  let state: WebStateResponse | undefined;
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fetchController: AbortController | undefined;
  let disposed = false;
  let attempt = 0;

  const publish = (next: WebStateResponse) => {
    state = next;
    options.onState(next);
  };

  const recover = async () => {
    fetchController?.abort();
    fetchController = new AbortController();
    try {
      publish(await api.state(fetchController.signal));
      if (!disposed) open();
    } catch (error) {
      if (disposed || fetchController.signal.aborted) return;
      options.onError(asError(error));
      schedule();
    }
  };

  const schedule = () => {
    if (disposed || timer) return;
    source?.close();
    source = undefined;
    options.onStatus("reconnecting");
    const delay = Math.min(5_000, 250 * 2 ** attempt++);
    timer = setTimeout(() => {
      timer = undefined;
      void recover();
    }, delay);
  };

  const open = () => {
    if (disposed) return;
    source?.close();
    source = createSource("/api/events");
    source.onopen = () => {
      attempt = 0;
      options.onStatus("connected");
    };
    source.addEventListener("state", (event) => {
      try {
        publish(
          applyEnvelope(
            state,
            JSON.parse((event as MessageEvent<string>).data),
          ),
        );
      } catch (error) {
        if (error instanceof WebRevisionGapError) {
          source?.close();
          void recover();
        } else options.onError(asError(error));
      }
    });
    source.onerror = schedule;
  };

  options.onStatus("connecting");
  void recover();
  return {
    dispose() {
      disposed = true;
      source?.close();
      fetchController?.abort();
      if (timer) clearTimeout(timer);
    },
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    if (response.status === 204 || response.status === 202)
      return undefined as T;
    return (await response.json()) as T;
  }
  let body: WebApiError | undefined;
  try {
    body = (await response.json()) as WebApiError;
  } catch {
    // Use the stable HTTP fallback below.
  }
  throw new WebRequestError(
    body?.error.code ?? "web.request_failed",
    body?.error.message ?? `Request failed with HTTP ${response.status}`,
    body?.error.retryable ?? false,
    response.status,
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
