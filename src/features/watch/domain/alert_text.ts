import { Transition, WatchAlert, WatchLang, WatchedFailure } from './watch_types.js';

/** Spanish names with their grammatical number ("se rompió el typecheck" / "se rompieron las pruebas"). */
const ES_CHECKS: Record<string, { name: string; plural: boolean }> = {
  test: { name: 'las pruebas', plural: true },
  typecheck: { name: 'el typecheck', plural: false },
  lint: { name: 'el lint', plural: false },
  build: { name: 'el build', plural: false },
};

const EN_CHECKS: Record<string, string> = { test: 'tests', typecheck: 'typecheck', lint: 'lint', build: 'build' };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function firstLocated(failures: WatchedFailure[]): WatchedFailure | undefined {
  return failures.find((f) => f.file) ?? failures[0];
}

function location(f: WatchedFailure | undefined): string {
  if (!f?.file) return '';
  return f.line ? `${f.file}:${f.line}` : f.file;
}

/** "src/features/qa/qa_runner_service.ts" → "qa runner service": what a voice can read. */
export function spokenFileName(file: string | undefined): string {
  if (!file) return '';
  const base = file.split(/[\\/]/).pop() ?? file;
  return base
    .replace(/\.(test|spec)\.[^.]+$/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-.]+/g, ' ')
    .trim();
}

function detail(failures: WatchedFailure[]): string {
  const f = firstLocated(failures);
  if (!f) return '';
  const what = (f.testName ? `${f.testName}: ` : '') + f.errorMessage.split(/\r?\n/)[0];
  // Runners often repeat the location in the message itself; don't print it twice.
  const where = f.file && what.includes(f.file) ? '' : location(f);
  const text = where ? `${where} — ${what}` : what;
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export function toAlert(t: Transition, lang: WatchLang, multiStack = false): WatchAlert {
  const r = t.result;
  const important = t.kind === 'broke' || t.kind === 'fixed' || t.kind === 'baseline_failing';
  const level = t.kind === 'fixed' || t.kind === 'baseline_ok' ? 'success' : t.kind === 'still_failing' ? 'info' : 'error';
  const file = spokenFileName(firstLocated(r.failures)?.file);
  const prefix = multiStack ? `[${r.stack}] ` : '';
  const failing = r.failed || 1;
  const detailText = detail(r.failures);
  // Runners that only report an exit code have no counts: say nothing rather than "0 passing".
  const count = (word: string) => (r.total > 0 ? `${r.total} ${word}` : '');

  if (lang === 'es') {
    const c = ES_CHECKS[r.check] ?? { name: `el check ${r.check}`, plural: false };
    const en = file ? ` en ${file}` : '';
    const fallo = `${failing} ${failing === 1 ? 'fallo' : 'fallos'}`;
    const texts: Record<Transition['kind'], [string, string, string]> = {
      broke: [`✗ Se ${c.plural ? 'rompieron' : 'rompió'} ${c.name}`, `${fallo}${detailText ? `: ${detailText}` : ''}`, `Se ${c.plural ? 'rompieron' : 'rompió'} ${c.name}${en}.`],
      fixed: [`✓ ${capitalize(c.name)} ${c.plural ? 'vuelven' : 'vuelve'} a pasar`, count('en verde'), `${capitalize(c.name)} ${c.plural ? 'vuelven' : 'vuelve'} a pasar.`],
      baseline_failing: [`✗ ${capitalize(c.name)} ${c.plural ? 'están' : 'está'} fallando`, `${fallo}${detailText ? `: ${detailText}` : ''}`, `${capitalize(c.name)} ${c.plural ? 'están' : 'está'} fallando${en}.`],
      still_failing: [`✗ ${capitalize(c.name)} ${c.plural ? 'siguen' : 'sigue'} fallando`, `${fallo}${detailText ? `: ${detailText}` : ''}`, ''],
      baseline_ok: [`✓ ${capitalize(c.name)} en verde`, count('en verde'), ''],
    };
    const [title, body, spoken] = texts[t.kind];
    return { kind: t.kind, level, important, title, body: prefix + body, spoken };
  }

  const name = EN_CHECKS[r.check] ?? r.check;
  const verb = r.check === 'test' ? 'are' : 'is';
  const inFile = file ? ` in ${file}` : '';
  const failingText = `${failing} failing${detailText ? `: ${detailText}` : ''}`;
  const texts: Record<Transition['kind'], [string, string, string]> = {
    broke: [`✗ ${capitalize(name)} broke`, failingText, `The ${name} broke${inFile}.`],
    fixed: [`✓ ${capitalize(name)} ${verb} green again`, count('passing'), `The ${name} ${verb} green again.`],
    baseline_failing: [`✗ ${capitalize(name)} ${verb} failing`, failingText, `The ${name} ${verb} failing${inFile}.`],
    still_failing: [`✗ ${capitalize(name)} still failing`, failingText, ''],
    baseline_ok: [`✓ ${capitalize(name)} passing`, count('passing'), ''],
  };
  const [title, body, spoken] = texts[t.kind];
  return { kind: t.kind, level, important, title, body: prefix + body, spoken };
}

/** HEXACORE_LANG, then the system locale; English otherwise. */
export function detectLang(explicit?: string, env: string | undefined = process.env.HEXACORE_LANG): WatchLang {
  const pick = (v?: string) => (v?.toLowerCase().startsWith('es') ? 'es' : v?.toLowerCase().startsWith('en') ? 'en' : undefined);
  return pick(explicit) ?? pick(env) ?? pick(Intl.DateTimeFormat().resolvedOptions().locale) ?? 'en';
}
