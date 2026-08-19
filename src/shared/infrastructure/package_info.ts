import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** This file lives at src/shared/infrastructure (dist mirrors the same depth), two levels below the repo root. */
const packageJsonPath = path.join(__dirname, '../../../package.json');

export function getPackageVersion(): string {
  return JSON.parse(readFileSync(packageJsonPath, 'utf-8')).version;
}
