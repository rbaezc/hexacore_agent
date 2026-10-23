import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** This file lives at src/shared/infrastructure (dist mirrors the same depth), two levels below the repo root. */
const packageRoot = path.join(__dirname, '../../..');

export function getPackageRoot(): string {
  return packageRoot;
}

export function getPackageVersion(): string {
  return JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')).version;
}

/** Architecture rules that ship with HexaCore itself, independent of whichever workspace it operates on. */
export function getBundledRulesDir(): string {
  return path.join(packageRoot, 'docs', 'rules');
}
