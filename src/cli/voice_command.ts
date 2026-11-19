import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createHexaCore } from '../composition_root.js';
import { createToolRegistry } from '../features/mcp_server/infrastructure/mcp_server_factory.js';
import { SpeechNotifier, detectLang } from '../features/watch/index.js';
import {
  FfmpegRecorder,
  Recording,
  ToolCaller,
  VoiceReply,
  VoiceSession,
  WHISPER_MODELS,
  WhisperModel,
  WhisperTranscriber,
  downloadModel,
  modelFile,
  modelUrl,
  whisperCandidates,
} from '../features/voice/index.js';
import { openInBrowser } from './open_browser.js';

type Flags = Record<string, string | boolean>;

const hexacoreHome = () => path.resolve(process.env.HEXACORE_HOME ?? path.join(os.homedir(), '.hexacore'));
const modelsDir = () => path.join(hexacoreHome(), 'models');

function pickModel(flags: Flags): WhisperModel | Error {
  const m = typeof flags.model === 'string' ? flags.model : 'base';
  return (WHISPER_MODELS as readonly string[]).includes(m) ? (m as WhisperModel) : new Error(`Unknown model '${m}' (use ${WHISPER_MODELS.join(', ')})`);
}

const modelPath = (model: WhisperModel) => process.env.HEXACORE_WHISPER_MODEL ?? modelFile(modelsDir(), model);

/** `hexacore listen`: push-to-talk voice commands in the terminal, with typing as a fallback. */
export async function runListen(workspaceRoot: string | undefined, flags: Flags): Promise<number> {
  const model = pickModel(flags);
  if (model instanceof Error) return (console.error(`Error: ${model.message}`), 1);
  const lang = detectLang(typeof flags.lang === 'string' ? flags.lang : undefined);
  const es = lang === 'es';

  const services = createHexaCore({ workspaceRoot, preview: { keepAlive: true } });
  const registry = createToolRegistry(services);
  const stack = (await services.stackDetector.detectActiveStacks(services.workspace.root))[0] ?? 'node';
  const tools: ToolCaller = {
    call: (tool, input) =>
      registry.call(tool, tool === 'run_quality_assurance' && !input.stack ? { ...input, stack } : input, {
        reportProgress: async (m) => void console.error(`  … ${m}`),
      }),
  };
  const session = new VoiceSession({ tools, lang, open: openInBrowser });
  const speaker = flags.mute === true ? undefined : new SpeechNotifier(lang);
  const recorder = new FfmpegRecorder();
  const transcriber = new WhisperTranscriber({ candidates: whisperCandidates(hexacoreHome()), modelPath: modelPath(model) });

  const voiceReady = existsSync(modelPath(model));
  console.error(
    es
      ? `🎙  Enter para hablar, Enter para terminar. También puedes escribir un comando. "ayuda" o "salir".`
      : `🎙  Press Enter to talk, Enter again to stop. You can also type a command. "help" or "exit".`
  );
  if (!voiceReady) console.error(es ? '   (La voz aún no está lista: corre `hexacore voice setup`. Mientras, escribe los comandos.)' : '   (Voice is not set up yet: run `hexacore voice setup`. Meanwhile, type commands.)');

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: false });
  let recording: Recording | undefined;
  let finished = false;
  // Lines are handled one at a time, in order: Enter while transcribing waits its turn instead of being lost.
  let queue: Promise<void> = Promise.resolve();

  const respond = async (reply: VoiceReply) => {
    console.error(`🗣  ${reply.text}`);
    if (reply.detail) console.error(reply.detail.replace(/^/gm, '   '));
    await speaker?.say(reply.text).catch((e: Error) => console.error(`   ! ${e.message}`));
  };

  const handleLine = async (line: string): Promise<void> => {
    if (finished) return;
    let text = line.trim();
    if (recording) {
      const wav = await recording.stop();
      recording = undefined;
      if (wav.isFailure) return void console.error(`   ! ${wav.error.message}`);
      console.error(es ? '   … transcribiendo' : '   … transcribing');
      const heard = await transcriber.transcribe(wav.value, lang);
      if (heard.isFailure) return void console.error(`   ! ${heard.error.message}`);
      text = heard.value;
      console.error(`›  ${text || (es ? '(no escuché nada)' : '(heard nothing)')}`);
      if (!text) return;
    } else if (!text) {
      const started = await recorder.start();
      if (started.isFailure) return void console.error(`   ! ${started.error.message}`);
      recording = started.value;
      return void console.error(es ? '●  Grabando… Enter para terminar' : '●  Recording… press Enter to stop');
    }
    const reply = await session.handle(text);
    await respond(reply);
    if (reply.done) {
      finished = true;
      rl.close();
    }
  };

  return new Promise<number>((resolve) => {
    rl.on('line', (line) => {
      queue = queue.then(() => handleLine(line)).catch((e: Error) => console.error(`   ! ${e.message}`));
    });
    rl.on('close', () => {
      queue.then(async () => {
        await recording?.stop();
        resolve(0);
      });
    });
  });
}

/** Whether an executable starts at all (ENOENT = not installed). */
function runs(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', () => resolve(false));
    child.on('exit', () => resolve(true));
  });
}

/** `hexacore voice setup`: checks ffmpeg + microphone and whisper.cpp, and downloads the model. */
export async function runVoiceSetup(flags: Flags): Promise<number> {
  const model = pickModel(flags);
  if (model instanceof Error) return (console.error(`Error: ${model.message}`), 1);
  let ready = true;

  const devices = await new FfmpegRecorder().listDevices();
  if (devices.isFailure) {
    ready = false;
    console.error(`✗ ffmpeg: ${devices.error.message}`);
  } else if (process.platform === 'win32') {
    if (devices.value.length === 0) ready = false;
    console.error(devices.value.length ? `✓ Microphones: ${devices.value.join(' | ')} (using the first; HEXACORE_MIC picks another)` : '✗ No microphone found by ffmpeg.');
  } else {
    console.error(`✓ ffmpeg found (${process.platform === 'darwin' ? 'avfoundation' : 'PulseAudio'} default input; HEXACORE_MIC picks another)`);
  }

  let whisper: string | undefined;
  for (const exe of whisperCandidates(hexacoreHome())) if (!whisper && (await runs(exe, ['-h']))) whisper = exe;
  if (whisper) console.error(`✓ whisper.cpp: ${whisper}`);
  else {
    ready = false;
    console.error(
      `✗ whisper.cpp is not installed. Get a build from https://github.com/ggml-org/whisper.cpp/releases ` +
        `(Windows: whisper-bin-x64.zip) and unzip it into ${path.join(hexacoreHome(), 'whisper')} so whisper-cli is there, ` +
        `or set HEXACORE_WHISPER to the whisper-cli executable.`
    );
  }

  const target = modelPath(model);
  if (existsSync(target)) console.error(`✓ Model: ${target}`);
  else {
    console.error(`↓ Downloading the ${model} model from ${modelUrl(model)}`);
    let lastPct = -1;
    const done = await downloadModel(model, modelsDir(), (got, total) => {
      const pct = total ? Math.floor((got / total) * 100) : -1;
      if (pct >= 0 && pct !== lastPct && pct % 10 === 0) console.error(`  ${pct}% of ${Math.round(total! / 1e6)} MB`);
      lastPct = pct;
    });
    if (done.isFailure) {
      ready = false;
      console.error(`✗ ${done.error.message}`);
    } else console.error(`✓ Model: ${done.value}`);
  }

  console.error(ready ? 'Voice is ready: run `hexacore listen`.' : 'Fix the items marked ✗ and run `hexacore voice setup` again.');
  return ready ? 0 : 1;
}
