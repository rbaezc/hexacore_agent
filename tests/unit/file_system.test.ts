import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { NodeFileSystem } from '../../src/shared/infrastructure/file_system.js';

describe('NodeFileSystem.writeFileAtomic', () => {
  it('should write the file atomically and leave no temp file behind', async () => {
    const targetPath = path.join(process.cwd(), '.hexagen', 'test_atomic.json');
    const content = JSON.stringify({ status: 'ok', timestamp: Date.now() });
    const nodeFs = new NodeFileSystem();

    await nodeFs.writeFileAtomic(targetPath, content);

    const fileContent = await fs.readFile(targetPath, 'utf-8');
    expect(fileContent).toBe(content);

    const dirEntries = await fs.readdir(path.dirname(targetPath));
    expect(dirEntries.some((f) => f.endsWith('.tmp'))).toBe(false);

    await fs.unlink(targetPath);
  });
});
