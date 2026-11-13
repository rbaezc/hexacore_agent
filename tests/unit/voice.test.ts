import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ok, fail } from '../../src/shared/domain/result.js';
import {
  cleanTranscript,
  downloadModel,
  parseAnswer,
  parseDshowAudioDevices,
  parseIntent,
  ToolCaller,
  VoiceSession,
  WhisperTranscriber,
} from '../../src/features/voice/index.js';

describe('intents', () => {
  it.each([
    ['¿En qué nos quedamos?', { name: 'resume' }],
    ['where did we leave off', { name: 'resume' }],
    ['Corre las pruebas', { name: 'run_checks', checks: ['test'] }],
    ['ejecuta el typecheck y el lint', { name: 'run_checks', checks: ['typecheck', 'lint'] }],
    ['run everything', { name: 'run_checks', checks: undefined }],
    ['las pruebas', { name: 'run_checks', checks: ['test'] }],
    ['¿Cómo va el vigía?', { name: 'watch_status' }],
    ['is anything broken?', { name: 'watch_status' }],
    ['muestra los prototipos', { name: 'list_prototypes' }],
    ['Abre el prototipo landing page', { name: 'open_prototype', target: 'landing-page' }],
    ['open the prototype', { name: 'open_prototype', target: undefined }],
    ['Revierte el último cambio', { name: 'rollback_last' }],
    // How Whisper actually transcribed it in the speech round-trip test.
    ['Reverte el último cambio.', { name: 'rollback_last' }],
    ['revert the last change', { name: 'rollback_last' }],
    ['lista los checkpoints', { name: 'list_checkpoints' }],
    ['¿Qué puedes hacer?', { name: 'help' }],
    ['Adiós', { name: 'exit' }],
  ])('%s', (text, expected) => {
    expect(parseIntent(text)).toEqual(expected);
  });

  it('does not guess at sentences it does not know', () => {
    expect(parseIntent('me gusta el café')).toBeUndefined();
    expect(parseIntent('   ')).toBeUndefined();
  });

  it('understands yes and no in both languages', () => {
    expect(['Sí', 'claro, hazlo', 'yes please', 'go ahead'].map(parseAnswer)).toEqual(['yes', 'yes', 'yes', 'yes']);
    expect(['No', 'mejor no', 'cancel'].map(parseAnswer)).toEqual(['no', 'no', 'no']);
    expect(parseAnswer('quizás')).toBeUndefined();
  });
});

function fakeTools(responses: Record<string, any>) {
  const calls: { tool: string; input: Record<string, unknown> }[] = [];
  const tools: ToolCaller = {
    call: async (tool, input) => {
      calls.push({ tool, input });
      const r = responses[tool];
      if (r instanceof Error) return fail(r);
      return r === undefined ? fail(new Error(`unexpected tool ${tool}`)) : ok(typeof r === 'function' ? r(input) : r);
    },
  };
  return { tools, calls };
}

const CHECKPOINTS = [
  { id: 'cp_2', label: 'Scaffold orders', status: 'open', files: ['src/a.ts', 'src/b.ts'] },
  { id: 'cp_1', label: 'Old', status: 'open', files: [] },
];

describe('VoiceSession', () => {
  it('summarizes the session briefing and the watch status', async () => {
    const { tools } = fakeTools({
      resume_session: {
        briefing: 'full text',
        latestHandoff: { summary: 'Watch mode done.', nextSteps: ['Voice commands'] },
        pendingPlans: [],
        recentDecisions: [{ title: 'HexaCore 3.5: watch mode and voice commands' }],
        lastQa: [{ stack: 'node', check: 'test', status: 'failed', failed: 2, source: 'watch', at: 't' }, { stack: 'node', check: 'typecheck', status: 'passed', failed: 0, at: 't' }],
      },
    });
    const s = new VoiceSession({ tools, lang: 'es' });
    const resume = await s.handle('¿en qué nos quedamos?');
    expect(resume.text).toBe('La última vez: Watch mode done. Lo siguiente era: Voice commands En rojo: las pruebas (2), según el vigía. Última decisión: HexaCore 3.5: watch mode and voice commands.');
    expect(resume.detail).toBe('full text');
    expect((await s.handle('hay algo roto')).text).toBe('En rojo: las pruebas (2), según el vigía.');
  });

  it('runs checks and speaks the result', async () => {
    const { tools, calls } = fakeTools({
      run_quality_assurance: {
        results: [
          { check: 'typecheck', status: 'passed', failedTestsCount: 0, failures: [] },
          { check: 'test', status: 'failed', failedTestsCount: 1, failures: [{ file: 'tests/unit/watch.test.ts', line: 9, errorMessage: 'expected 1' }] },
        ],
      },
    });
    const reply = await new VoiceSession({ tools, lang: 'es' }).handle('corre todo');
    expect(calls[0]).toEqual({ tool: 'run_quality_assurance', input: { checks: ['typecheck', 'test'] } });
    expect(reply.text).toBe('El typecheck pasa. Las pruebas tienen 1 fallo, el primero en watch.');
    expect(reply.detail).toBe('tests/unit/watch.test.ts:9 expected 1');
  });

  it('asks before rolling back and only rolls back after a yes', async () => {
    const { tools, calls } = fakeTools({ list_checkpoints: CHECKPOINTS, rollback_changes: { restored: 2 } });
    const s = new VoiceSession({ tools, lang: 'es' });
    const ask = await s.handle('deshaz el último cambio');
    expect(ask).toMatchObject({ awaitingConfirmation: true, text: 'Voy a revertir "Scaffold orders", que tocó 2 archivos. ¿Lo hago?' });
    expect(calls.map((c) => c.tool)).toEqual(['list_checkpoints']);

    expect((await s.handle('sí')).text).toBe('Listo, revertí "Scaffold orders".');
    expect(calls[1]).toEqual({ tool: 'rollback_changes', input: { checkpointId: 'cp_2' } });
  });

  it('cancels on no, or on any other command, without writing', async () => {
    const { tools, calls } = fakeTools({ list_checkpoints: CHECKPOINTS, resume_session: { lastQa: [] } });
    const s = new VoiceSession({ tools, lang: 'en' });
    await s.handle('undo the last change');
    expect((await s.handle('no')).text).toBe("Cancelled, I didn't change anything.");
    await s.handle('undo the last change');
    expect((await s.handle('is anything broken')).text).toBe("Cancelled, I didn't change anything. No checks have run yet.");
    expect(calls.some((c) => c.tool === 'rollback_changes')).toBe(false);
    expect(s.awaitingConfirmation).toBe(false);
  });

  it('reports a refused rollback instead of forcing it', async () => {
    const { tools, calls } = fakeTools({ list_checkpoints: CHECKPOINTS, rollback_changes: new Error('src/a.ts was edited after the checkpoint') });
    const s = new VoiceSession({ tools, lang: 'es' });
    await s.handle('revierte');
    expect((await s.handle('dale')).text).toBe('No lo revertí: src/a.ts was edited after the checkpoint');
    expect(calls.filter((c) => c.tool === 'rollback_changes').every((c) => !c.input.force)).toBe(true);
  });

  it('opens a prototype preview by name', async () => {
    const opened: string[] = [];
    const { tools } = fakeTools({ list_prototypes: { prototypes: [{ name: 'shop', current: 1, previewUrl: 'http://127.0.0.1:4173/shop/' }, { name: 'landing-page', current: 3, previewUrl: 'http://127.0.0.1:4173/landing-page/' }] } });
    const s = new VoiceSession({ tools, lang: 'es', open: (u) => opened.push(u) });
    expect((await s.handle('abre el prototipo landing page')).text).toBe('Abriendo landing page, versión 3.');
    expect(opened).toEqual(['http://127.0.0.1:4173/landing-page/']);
    expect((await s.handle('muestra los prototipos')).text).toBe('Hay 2: shop y landing page.');
  });

  it('answers what it did not understand, and says goodbye', async () => {
    const s = new VoiceSession({ tools: fakeTools({}).tools, lang: 'es' });
    expect((await s.handle('me gusta el café')).text).toMatch(/No te entendí/);
    expect(await s.handle('salir')).toEqual({ text: 'Hasta luego.', done: true });
  });
});

describe('audio plumbing', () => {
  it('finds audio devices in both ffmpeg dshow listing formats', () => {
    const modern = `[dshow @ 0x1] "Integrated Camera" (video)\n[dshow @ 0x1]   Alternative name "@device_pnp_..."\n[dshow @ 0x1] "Micrófono (Realtek(R) Audio)" (audio)\n[dshow @ 0x1]   Alternative name "@device_cm_..."`;
    const legacy = `[dshow @ 0x1] DirectShow video devices\n[dshow @ 0x1]  "Cam"\n[dshow @ 0x1] DirectShow audio devices\n[dshow @ 0x1]  "Headset Mic"`;
    expect(parseDshowAudioDevices(modern)).toEqual(['Micrófono (Realtek(R) Audio)']);
    expect(parseDshowAudioDevices(legacy)).toEqual(['Headset Mic']);
  });

  it('strips whisper markers from the transcript', () => {
    expect(cleanTranscript(' [BLANK_AUDIO]\n Corre las pruebas.\n (música) ')).toBe('Corre las pruebas.');
  });

  it('points to setup when the model is missing', async () => {
    const t = new WhisperTranscriber({ candidates: ['whisper-cli'], modelPath: path.join(os.tmpdir(), 'nope', 'ggml-base.bin') });
    const res = await t.transcribe('x.wav', 'es');
    expect(res.isFailure && res.error.message).toMatch(/hexacore voice setup/);
  });

  it('downloads a model through a .part file and never leaves a truncated one', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hexacore-models-'));
    const body = (bytes: string, length: number) =>
      (async () => new Response(new Blob([bytes]).stream(), { headers: { 'content-length': String(length) } })) as unknown as typeof fetch;

    const good = await downloadModel('tiny', dir, () => undefined, body('weights', 7));
    expect(good.isSuccess && readFileSync(good.value, 'utf-8')).toBe('weights');

    const bad = await downloadModel('base', dir, () => undefined, body('half', 100));
    expect(bad.isFailure && bad.error.message).toMatch(/incomplete download/);
    expect(existsSync(path.join(dir, 'ggml-base.bin'))).toBe(false);
    expect(existsSync(path.join(dir, 'ggml-base.bin.part'))).toBe(false);
  });
});
