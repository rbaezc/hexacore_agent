import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AtomicFileWriter } from '../../src/features/state_management/services/atomic_file_writer.js';

describe('AtomicFileWriter', () => {
  it('should write file atomically without leaving temporary files behind', async () => {
    const targetPath = path.join(process.cwd(), '.hexagen', 'test_atomic.json');
    const content = JSON.stringify({ status: 'ok', timestamp: Date.now() });

    const result = await AtomicFileWriter.writeAtomic(targetPath, content);
    expect(result.isSuccess).toBe(true);

    const fileContent = await fs.readFile(targetPath, 'utf-8');
    expect(fileContent).toBe(content);

    // Cleanup test file
    await fs.unlink(targetPath);
  });
});
