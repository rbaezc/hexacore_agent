import * as fs from 'node:fs';
import { FileWatcher } from '../domain/watch_types.js';

/** Recursive fs.watch (native on Windows and macOS, supported on Linux since Node 20). */
export class NodeFileWatcher implements FileWatcher {
  private watcher?: fs.FSWatcher;

  constructor(
    private readonly root: string,
    private readonly onError: (error: Error) => void = () => undefined
  ) {}

  start(onChange: (relPath: string) => void): void {
    this.stop();
    this.watcher = fs.watch(this.root, { recursive: true, persistent: true }, (_event, filename) => {
      if (filename) onChange(filename.toString().replace(/\\/g, '/'));
    });
    this.watcher.on('error', (error) => this.onError(error));
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }
}
