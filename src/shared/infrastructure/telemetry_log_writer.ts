import { EventBus, DomainEvent } from '../domain/event_bus.js';
import { IFileSystem } from './file_system.js';
import { WorkspaceContext } from './workspace.js';

/** Subscribes to telemetry spans and persists them as a JSONL audit log under `.hexagen/telemetry.log`. */
export class TelemetryLogWriter {
  private readonly workspace: WorkspaceContext;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly fileSystem: IFileSystem,
    workspaceOrBaseDir: WorkspaceContext | string = new WorkspaceContext(),
    private readonly eventBus: EventBus = EventBus.getInstance()
  ) {
    this.workspace = typeof workspaceOrBaseDir === 'string' ? new WorkspaceContext(workspaceOrBaseDir) : workspaceOrBaseDir;
  }

  start(): void {
    this.eventBus.subscribe('telemetry.span_completed', async (event: DomainEvent) => {
      await this.append(event);
    });
  }

  private append(event: DomainEvent): Promise<void> {
    // Append-only: rewriting the whole log on every span made each write O(log size).
    this.writeQueue = this.writeQueue.then(() =>
      this.fileSystem.appendFile(this.workspace.hexagenPath('telemetry.log'), `${JSON.stringify(event)}\n`)
    );
    return this.writeQueue;
  }
}
