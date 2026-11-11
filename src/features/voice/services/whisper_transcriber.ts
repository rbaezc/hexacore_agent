import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { Transcriber, VoiceLang } from '../domain/voice_types.js';

export const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium'] as const;
export type WhisperModel = (typeof WHISPER_MODELS)[number];

export const modelFile = (modelsDir: string, model: WhisperModel) => path.join(modelsDir, `ggml-${model}.bin`);

/** Candidate whisper.cpp executables, most specific first. */
export function whisperCandidates(home: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const exe = platform === 'win32' ? '.exe' : '';
  const local = [path.join(home, 'whisper', `whisper-cli${exe}`), path.join(home, 'whisper', 'Release', `whisper-cli${exe}`)].filter((p) => existsSync(p));
  return [...(env.HEXACORE_WHISPER ? [env.HEXACORE_WHISPER] : []), ...local, 'whisper-cli', 'whisper-cpp'];
}

/** whisper.cpp prints the text with markers for silence/noise; keep only what was said. */
export function cleanTranscript(stdout: string): string {
  return stdout
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*(music|música|silence|silencio|noise|ruido)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface WhisperOptions {
  /** Executables to try in order (see whisperCandidates). */
  candidates: string[];
  modelPath: string;
}

/** Offline speech-to-text with whisper.cpp: the audio never leaves the machine. */
export class WhisperTranscriber implements Transcriber {
  constructor(private readonly options: WhisperOptions) {}

  async transcribe(wavPath: string, lang: VoiceLang): Promise<Result<string, Error>> {
    if (!existsSync(this.options.modelPath)) {
      return fail(new Error(`Whisper model not found at ${this.options.modelPath}. Run \`hexacore voice setup\` to download it.`));
    }
    const args = ['-m', this.options.modelPath, '-f', wavPath, '-l', lang, '-nt', '-np'];
    for (const exe of this.options.candidates) {
      const run = await this.run(exe, args);
      if (run === 'not_found') continue;
      if (run.code !== 0) return fail(new Error(`whisper failed (exit ${run.code}): ${run.stderr.trim().split(/\r?\n/).pop() ?? ''}`));
      return ok(cleanTranscript(run.stdout));
    }
    return fail(new Error('whisper.cpp is not installed. Run `hexacore voice setup` for instructions, or set HEXACORE_WHISPER to whisper-cli.'));
  }

  private run(cmd: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string } | 'not_found'> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'ENOENT' ? 'not_found' : { code: -1, stdout, stderr: e.message }));
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
    });
  }
}
