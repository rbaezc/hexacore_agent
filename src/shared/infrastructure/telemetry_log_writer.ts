import * as path from 'node:path';
import { EventBus, DomainEvent } from '../domain/event_bus.js';
import { IFileSystem } from './file_system.js';

/** Subscribes to telemetry spans and persists them as a JSONL audit log under `.hexagen/telemetry.log`. */
export class TelemetryLogWriter {
  private readonly logPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly fileSystem: IFileSystem,
    baseDir: string = process.cwd(),
    private readonly eventBus: EventBus = EventBus.getInstance()
  ) {
    this.logPath = path.join(baseDir, '.hexagen', 'telemetry.log');
  }

  start(): void {
    this.eventBus.subscribe('telemetry.span_completed', async (event: DomainEvent) => {
      await this.append(event);
    });
  }

  private append(event: DomainEvent): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const existing = (await this.fileSystem.exists(this.logPath)) ? await this.fileSystem.readFile(this.logPath) : '';
      await this.fileSystem.writeFile(this.logPath, `${existing}${JSON.stringify(event)}\n`);
    });
    return this.writeQueue;
  }
}
