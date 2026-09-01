import type { AgentApplication, CreateAgentApplicationOptions } from "../cli/agent-application.js";
import { createAgentApplication } from "../cli/agent-application.js";
import type { AgentCommandOptions } from "../cli/agent-command.js";
import type { I18n } from "../i18n/i18n.js";
import { isValidSessionId } from "../sessions/store.js";
import type { WebInteractionDecision, WebViewer } from "./protocol.js";
import type { WebStore } from "./store.js";

export class WebControllerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 403 | 409 | 500,
  ) {
    super(message);
    this.name = "WebControllerError";
  }
}

export interface WebControllerOptions {
  workspace: string;
  command: AgentCommandOptions;
  i18n: I18n;
  store: WebStore;
  createApplication?: (options: CreateAgentApplicationOptions) => Promise<AgentApplication>;
  onDiagnostic?: (message: string) => void;
}

export class WebController {
  readonly #workspace: string;
  readonly #command: AgentCommandOptions;
  readonly #i18n: I18n;
  readonly #store: WebStore;
  readonly #factory: (options: CreateAgentApplicationOptions) => Promise<AgentApplication>;
  readonly #onDiagnostic: (message: string) => void;
  #application: AgentApplication | undefined;
  #activeController: AbortController | undefined;
  #activeTurn: Promise<void> | undefined;
  #eventUnsubscribe: (() => void) | undefined;
  #disposed = false;

  constructor(options: WebControllerOptions) {
    this.#workspace = options.workspace;
    this.#command = options.command;
    this.#i18n = options.i18n;
    this.#store = options.store;
    this.#factory = options.createApplication ?? createAgentApplication;
    this.#onDiagnostic = options.onDiagnostic ?? (() => {});
  }

  get store(): WebStore {
    return this.#store;
  }

  get ready(): boolean {
    return this.#application !== undefined;
  }

  async bootstrap(): Promise<void> {
    await this.#replaceApplication(
      typeof this.#command.resume === "string" ? this.#command.resume : undefined,
      false,
    );
  }

  connectClient(clientId: string): WebViewer {
    const owner = this.#store.snapshot().control.ownerClientId;
    if (!owner) this.#store.setOwner(clientId);
    return {
      clientId,
      isOwner: this.#store.snapshot().control.ownerClientId === clientId,
    };
  }

  disconnectClient(_clientId: string): void {
    // Ownership intentionally survives disconnects and refreshes.
  }

  takeover(clientId: string): void {
    this.#ensureUsable();
    this.#store.setOwner(clientId);
  }

  submit(clientId: string, text: string): void {
    this.#requireOwner(clientId);
    this.#ensureReady();
    if (!text.trim())
      throw new WebControllerError("web.invalid_prompt", "Prompt must not be empty", 400);
    if (this.#activeTurn || this.#store.snapshot().pendingInteractionId)
      throw new WebControllerError("web.busy", "The Agent is already running", 409);
    const application = this.#application;
    if (!application) this.#ensureReady();
    const controller = new AbortController();
    this.#activeController = controller;
    const turn = application?.runtime
      .run(text, controller.signal)
      .then(() => this.#refreshSessions())
      .catch((error: unknown) => {
        if (!controller.signal.aborted) this.#onDiagnostic(errorMessage(error));
      })
      .finally(() => {
        if (this.#activeTurn === turn) {
          this.#activeTurn = undefined;
          this.#activeController = undefined;
        }
      });
    if (!turn) throw new WebControllerError("web.not_ready", "The Agent is not ready", 409);
    this.#activeTurn = turn;
  }

  cancel(clientId: string): void {
    this.#requireOwner(clientId);
    if (!this.#activeController)
      throw new WebControllerError("web.not_running", "There is no active turn", 409);
    this.#activeController.abort(new Error("Cancelled from Web interface"));
    this.#store.cancelInteraction();
  }

  answerInteraction(
    clientId: string,
    interactionId: string,
    decision: WebInteractionDecision,
  ): void {
    this.#requireOwner(clientId);
    if (this.#store.snapshot().pendingInteractionId !== interactionId)
      throw new WebControllerError(
        "web.interaction_stale",
        "The interaction is no longer pending",
        409,
      );
    try {
      this.#store.resolveInteraction(interactionId, decision);
    } catch (error) {
      throw new WebControllerError("web.interaction_stale", errorMessage(error), 409);
    }
  }

  async newSession(clientId: string): Promise<void> {
    this.#requireOwner(clientId);
    this.#requireIdle();
    await this.#replaceApplication(undefined, true);
  }

  async resumeSession(clientId: string, sessionId: string): Promise<void> {
    this.#requireOwner(clientId);
    this.#requireIdle();
    if (!isValidSessionId(sessionId))
      throw new WebControllerError("web.invalid_session", "Invalid session ID", 400);
    const exists = this.#store.snapshot().sessions.some((session) => session.id === sessionId);
    if (!exists) throw new WebControllerError("web.invalid_session", "Session does not exist", 400);
    await this.#replaceApplication(sessionId, true);
  }

  async shutdown(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#activeController?.abort(new Error("Web server is shutting down"));
    this.#store.cancelInteraction();
    await this.#activeTurn?.catch(() => {});
    const application = this.#application;
    this.#application = undefined;
    this.#eventUnsubscribe?.();
    this.#eventUnsubscribe = undefined;
    if (application) {
      await application.end("cancelled");
      await application.dispose();
    }
    this.#store.close();
  }

  dispose(): Promise<void> {
    return this.shutdown();
  }

  async #replaceApplication(resumeId: string | undefined, replacing: boolean): Promise<void> {
    this.#ensureUsable();
    this.#store.cancelInteraction();
    this.#store.setStarting();
    this.#store.clearFatal();
    const previous = this.#application;
    this.#application = undefined;
    this.#eventUnsubscribe?.();
    this.#eventUnsubscribe = undefined;
    if (previous) {
      await previous.end("completed");
      await previous.dispose();
    }
    const command: AgentCommandOptions = {
      ...this.#command,
      ...(resumeId === undefined ? { resume: false } : { resume: resumeId }),
    };
    try {
      const application = await this.#factory({
        workspace: this.#workspace,
        command,
        i18n: this.#i18n,
        interaction: {
          permission: (tool, call, risk, signal) =>
            this.#store.openPermission(tool, call, risk, signal).promise,
          confirm: (message, signal) => this.#store.openConfirm(message, signal).promise,
        },
        onEvents: (events) => {
          this.#eventUnsubscribe = this.#store.connect(events);
        },
        onHookDiagnostic: this.#onDiagnostic,
      });
      if (this.#disposed) {
        await application.dispose();
        return;
      }
      this.#application = application;
      this.#store.setRecoveredMessages(application.recoveredMessages);
      this.#store.setApplication(
        application.metadata,
        application.session.sessionId,
        application.startupWarnings,
      );
      await this.#refreshSessions();
    } catch (error) {
      this.#store.setFatal("web.application_failed", errorMessage(error));
      this.#onDiagnostic(errorMessage(error));
      if (replacing) throw error;
    }
  }

  async #refreshSessions(): Promise<void> {
    const sessions = await this.#application?.session.list();
    if (sessions) this.#store.setSessions(sessions);
  }

  #requireOwner(clientId: string): void {
    this.#ensureUsable();
    if (this.#store.snapshot().control.ownerClientId !== clientId)
      throw new WebControllerError("web.not_owner", "This client is read-only", 403);
  }

  #requireIdle(): void {
    if (this.#activeTurn || this.#store.snapshot().running)
      throw new WebControllerError("web.busy", "Wait for the current turn to finish", 409);
  }

  #ensureReady(): void {
    this.#ensureUsable();
    if (!this.#application)
      throw new WebControllerError("web.not_ready", "The Agent is not ready", 409);
  }

  #ensureUsable(): void {
    if (this.#disposed)
      throw new WebControllerError("web.closed", "The Web controller is closed", 409);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
