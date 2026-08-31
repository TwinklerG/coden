import {
  type AgentApplication,
  type CreateAgentApplicationOptions,
  createAgentApplication,
} from "../cli/agent-application.js";
import type { AgentCommandOptions } from "../cli/agent-command.js";
import { executeReplCommand } from "../cli/repl-command.js";
import type { I18n } from "../i18n/i18n.js";
import { CODEN_VERSION } from "../version.js";
import type { TuiStore } from "./store.js";

export interface TuiControllerOptions {
  initialPrompt?: string;
  command: AgentCommandOptions;
  i18n: I18n;
  store: TuiStore;
  workspace?: string;
  createApplication?: (options: CreateAgentApplicationOptions) => Promise<AgentApplication>;
  onExit(): void;
}

export class TuiController {
  readonly #options: TuiControllerOptions;
  #application: AgentApplication | undefined;
  #disconnect: (() => void) | undefined;
  #activeController: AbortController | undefined;
  #activeTurn: Promise<void> | undefined;
  #busy = false;
  #closing = false;
  #disposed = false;

  constructor(options: TuiControllerOptions) {
    this.#options = options;
  }

  get application(): AgentApplication | undefined {
    return this.#application;
  }

  async bootstrap(): Promise<void> {
    if (this.#application || this.#closing) return;
    const create = this.#options.createApplication ?? createAgentApplication;
    try {
      const application = await create({
        workspace: this.#options.workspace ?? process.cwd(),
        command: this.#options.command,
        i18n: this.#options.i18n,
        interaction: {
          confirm: (message, signal) => this.#options.store.requestConfirm(message, signal),
          permission: (tool, call, risk, signal) =>
            this.#options.store.requestPermission(tool, call, risk, signal),
        },
        onEvents: (events) => {
          this.#disconnect?.();
          this.#disconnect = this.#options.store.connect(events);
        },
      });
      if (this.#closing) {
        await application.dispose();
        return;
      }
      this.#application = application;
      this.#options.store.setMetadata(application.metadata);
      this.#options.store.setRecoveredMessages(application.recoveredMessages);
      for (const warning of application.startupWarnings)
        this.#options.store.addInfo(`coden: ${warning}`);
      if (application.recoveredMessages.length === 0) {
        this.#options.store.addInfo(
          `CodeN ${CODEN_VERSION} · ${application.metadata.workspaceId} · ${application.metadata.sessionId}`,
        );
      } else {
        this.#options.store.addInfo(
          this.#options.i18n.messages.format.resumed(
            application.metadata.sessionId,
            application.recoveredMessages.length,
          ),
        );
      }
      this.#options.store.setIdle();
      if (this.#options.initialPrompt) await this.submit(this.#options.initialPrompt);
    } catch (error) {
      this.#options.store.setFatal(error);
      await this.shutdown();
    }
  }

  async submit(text: string): Promise<void> {
    const application = this.#application;
    if (!application || this.#closing || this.#busy || !text.trim()) return;
    this.#busy = true;
    this.#options.store.setSubmitting();
    try {
      const command = await executeReplCommand(text, {
        runtime: application.runtime,
        session: application.session,
        reload: application.reload,
        registry: application.registry,
        skills: application.skills,
        i18n: this.#options.i18n,
        switchLanguage: application.switchLanguage,
        getThinkingStatus: application.getThinkingStatus,
        switchThinkingLevel: application.switchThinkingLevel,
      });
      if (command.type === "empty") return;
      if (command.type === "output") {
        this.#options.store.addInfo(command.text.trimEnd());
        return;
      }
      if (command.type === "exit") {
        await this.shutdown();
        return;
      }

      const controller = new AbortController();
      this.#activeController = controller;
      const turn = application.runtime
        .run(command.text, controller.signal)
        .then(() => {})
        .catch((error) => {
          if (!controller.signal.aborted) throw error;
        });
      this.#activeTurn = turn;
      try {
        await turn;
      } finally {
        if (this.#activeTurn === turn) this.#activeTurn = undefined;
        if (this.#activeController === controller) this.#activeController = undefined;
      }
    } catch (error) {
      this.#options.store.setFatal(error);
      await this.shutdown();
    } finally {
      this.#busy = false;
      if (!this.#closing && this.#options.store.getSnapshot().phase !== "failed")
        this.#options.store.setIdle();
    }
  }

  cancel(): void {
    this.#activeController?.abort(new Error("Cancelled by user"));
  }

  async requestExit(): Promise<void> {
    if (this.#activeController) {
      this.cancel();
      return;
    }
    await this.shutdown();
  }

  async shutdown(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    this.cancel();
    try {
      await this.#activeTurn;
    } catch {
      // Runtime already emitted a failure event; shutdown still restores the terminal.
    }
    await this.dispose();
    this.#options.onExit();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#disconnect?.();
    this.#disconnect = undefined;
    await this.#application?.dispose();
    this.#options.store.close();
  }
}
