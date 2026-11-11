import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Result, ok, fail } from '../../../shared/domain/result.js';
import { WhisperModel, modelFile } from './whisper_transcriber.js';

/** whisper.cpp's official model repository. */
export const modelUrl = (model: WhisperModel) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;

/**
 * Downloads a ggml Whisper model into modelsDir. Writes to a .part file first, so an
 * interrupted download never leaves a truncated model that whisper would fail on later.
 */
export async function downloadModel(
  model: WhisperModel,
  modelsDir: string,
  onProgress: (received: number, total?: number) => void = () => undefined,
  fetchImpl: typeof fetch = fetch
): Promise<Result<string, Error>> {
  const target = modelFile(modelsDir, model);
  const part = `${target}.part`;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    const res = await fetchImpl(modelUrl(model), { redirect: 'follow' });
    if (!res.ok || !res.body) return fail(new Error(`Download failed: HTTP ${res.status}`));
    const total = Number(res.headers.get('content-length')) || undefined;
    let received = 0;
    const body = Readable.fromWeb(res.body as any);
    body.on('data', (chunk: Buffer) => {
      received += chunk.length;
      onProgress(received, total);
    });
    await pipeline(body, createWriteStream(part));
    if (total && received !== total) throw new Error(`incomplete download (${received} of ${total} bytes)`);
    await rename(part, target);
    return ok(target);
  } catch (error: any) {
    await rm(part, { force: true }).catch(() => undefined);
    return fail(new Error(`Could not download the ${model} model: ${error.message}`));
  }
}
