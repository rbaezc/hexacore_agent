import { describe, it, expect } from 'vitest';
import { TelemetryLogWriter } from '../../src/shared/infrastructure/telemetry_log_writer.js';
import { TelemetryService } from '../../src/shared/infrastructure/telemetry.js';
import { EventBus } from '../../src/shared/domain/event_bus.js';
import { InMemoryFileSystem } from '../helpers/in_memory_fs.js';

describe('TelemetryLogWriter', () => {
  it('should persist completed spans as JSONL', async () => {
    const bus = new EventBus();
    const fs = new InMemoryFileSystem();
    const writer = new TelemetryLogWriter(fs, '/project', bus);
    writer.start();

    const telemetry = new TelemetryService(bus);
    const span = telemetry.startSpan('scaffold', 'req_1');
    await telemetry.endSpan(span, 'SUCCESS', { fileCount: 4 });

    const otherSpan = telemetry.startSpan('qa_check', 'req_1');
    await telemetry.endSpan(otherSpan, 'FAILURE', { error: 'boom' });

    const logPath = [...fs.files.keys()][0];
    const content = fs.files.get(logPath)!;
    const lines = content.trim().split('\n');

    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.payload.operationName).toBe('scaffold');
    expect(first.payload.status).toBe('SUCCESS');
    const second = JSON.parse(lines[1]);
    expect(second.payload.status).toBe('FAILURE');
  });
});
