import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { Recorder, Recording } from '../domain/voice_types.js';

export interface FfmpegRecorderOptions {
  /** ffmpeg executable (default "ffmpeg" on PATH, or $HEXACORE_FFMPEG). */
  ffmpeg?: string;
  /** Microphone: a DirectShow device name on Windows, an avfoundation index on macOS, a PulseAudio source on Linux ($HEXACORE_MIC). */
  device?: string;
  platform?: NodeJS.Platform;
}

/** Parses `ffmpeg -list_devices true -f dshow -i dummy`: the names of the audio capture devices. */
export function parseDshowAudioDevices(stderr: string): string[] {
  const names: string[] = [];
  let legacyAudioSection = false;
  for (const line of stderr.split(/\r?\n/)) {
    if (/DirectShow audio devices/i.test(line)) legacyAudioSection = true;
    else if (/DirectShow video devices/i.test(line)) legacyAudioSection = false;
    if (/Alternative name/i.test(line)) continue;
    const m = line.match(/"([^"]+)"(\s+\((audio|video)\))?/);
    if (!m) continue;
    if (m[3] === 'audio' || (!m[3] && legacyAudioSection)) names.push(m[1]);
  }
  return [...new Set(names)];
}

/**
 * Records the microphone to a 16 kHz mono WAV (what Whisper expects) with ffmpeg,
 * so no native Node module is needed. Recording stops when ffmpeg receives "q".
 */
export class FfmpegRecorder implements Recorder {
  private readonly ffmpeg: string;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly options: FfmpegRecorderOptions = {}) {
    this.ffmpeg = options.ffmpeg ?? process.env.HEXACORE_FFMPEG ?? 'ffmpeg';
    this.platform = options.platform ?? process.platform;
  }

  /** Audio input devices ffmpeg can see (Windows only; elsewhere the system default is used). */
  async listDevices(): Promise<Result<string[], Error>> {
    if (this.platform !== 'win32') return ok([]);
    const out = await this.capture(['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
    if (out.isFailure) return fail(out.error);
    return ok(parseDshowAudioDevices(out.value));
  }

  async inputArgs(): Promise<Result<string[], Error>> {
    const device = this.options.device ?? process.env.HEXACORE_MIC;
    if (this.platform === 'darwin') return ok(['-f', 'avfoundation', '-i', `:${device ?? '0'}`]);
    if (this.platform !== 'win32') return ok(['-f', 'pulse', '-i', device ?? 'default']);
    if (device) return ok(['-f', 'dshow', '-i', `audio=${device}`]);
    const devices = await this.listDevices();
    if (devices.isFailure) return fail(devices.error);
    if (devices.value.length === 0) return fail(new Error('No microphone found. Connect one, or set HEXACORE_MIC to a device name from `hexacore voice setup`.'));
    return ok(['-f', 'dshow', '-i', `audio=${devices.value[0]}`]);
  }

  async start(): Promise<Result<Recording, Error>> {
    const input = await this.inputArgs();
    if (input.isFailure) return fail(input.error);
    const file = path.join(os.tmpdir(), `hexacore-voice-${Date.now()}.wav`);
    const child = spawn(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...input.value, '-ac', '1', '-ar', '16000', file], {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    const exited = new Promise<number | null>((resolve) => {
      child.on('error', (e) => ((stderr += e.message), resolve(-1)));
      child.on('exit', (code) => resolve(code));
    });

    // A busy or missing device makes ffmpeg exit at once: report it now, not after the user spoke.
    const early = await Promise.race([exited, new Promise<'running'>((r) => setTimeout(() => r('running'), 400))]);
    if (early !== 'running') return fail(new Error(`The microphone could not be opened: ${stderr.trim() || `ffmpeg exited with ${early}`}`));

    return ok({
      stop: async () => {
        child.stdin?.write('q');
        child.stdin?.end();
        const timer = setTimeout(() => child.kill(), 5000);
        await exited;
        clearTimeout(timer);
        if (!existsSync(file) || statSync(file).size < 1000) return fail(new Error(`Nothing was recorded. ${stderr.trim()}`.trim()));
        return ok(file);
      },
    });
  }

  private capture(args: string[]): Promise<Result<string, Error>> {
    return new Promise((resolve) => {
      const child = spawn(this.ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      let stderr = '';
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('error', () => resolve(fail(new Error('ffmpeg is not installed or not on PATH (set HEXACORE_FFMPEG to its path).'))));
      child.on('exit', () => resolve(ok(stderr)));
    });
  }
}
