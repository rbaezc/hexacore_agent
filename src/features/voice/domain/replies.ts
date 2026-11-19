import { VoiceLang } from './voice_types.js';

/** Spoken names, with grammatical number for Spanish. */
const ES: Record<string, { name: string; plural: boolean }> = {
  test: { name: 'las pruebas', plural: true },
  typecheck: { name: 'el typecheck', plural: false },
  lint: { name: 'el lint', plural: false },
  build: { name: 'el build', plural: false },
};
const EN: Record<string, string> = { test: 'the tests', typecheck: 'the typecheck', lint: 'lint', build: 'the build' };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function checkName(check: string, lang: VoiceLang): string {
  return lang === 'es' ? (ES[check]?.name ?? check) : (EN[check] ?? check);
}

/** "src/features/qa/qa_runner_service.ts" → "qa runner service". */
export function speakableFile(file?: string): string {
  if (!file) return '';
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/\.(test|spec)\.[^.]+$/, '').replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ').trim();
}

export interface CheckOutcome {
  check: string;
  status: 'passed' | 'failed' | 'skipped';
  failed: number;
  firstFile?: string;
}

/** One sentence per check: "El typecheck pasa. Las pruebas tienen 2 fallos, el primero en watch." */
export function describeChecks(outcomes: CheckOutcome[], lang: VoiceLang): string {
  if (outcomes.length === 0) return lang === 'es' ? 'No había nada que revisar.' : 'There was nothing to check.';
  return outcomes
    .map((o) => {
      const name = checkName(o.check, lang);
      if (lang === 'es') {
        const plural = ES[o.check]?.plural ?? false;
        if (o.status === 'skipped') return `${cap(name)} no se ${plural ? 'pudieron' : 'pudo'} correr.`;
        if (o.status === 'passed') return `${cap(name)} ${plural ? 'pasan' : 'pasa'}.`;
        const where = o.firstFile ? `, el primero en ${speakableFile(o.firstFile)}` : '';
        return `${cap(name)} ${plural ? 'tienen' : 'tiene'} ${o.failed || 1} ${o.failed === 1 ? 'fallo' : 'fallos'}${where}.`;
      }
      if (o.status === 'skipped') return `${cap(name)} could not run.`;
      if (o.status === 'passed') return `${cap(name)} ${o.check === 'test' ? 'pass' : 'passes'}.`;
      const where = o.firstFile ? `, the first one in ${speakableFile(o.firstFile)}` : '';
      return `${cap(name)} ${o.check === 'test' ? 'have' : 'has'} ${o.failed || 1} ${o.failed === 1 ? 'failure' : 'failures'}${where}.`;
    })
    .join(' ');
}

type Key =
  | 'help'
  | 'bye'
  | 'notUnderstood'
  | 'noRuns'
  | 'allGreen'
  | 'noPrototypes'
  | 'noCheckpoints'
  | 'cancelled'
  | 'confirmHint'
  | 'rollbackDone'
  | 'rollbackRefused'
  | 'nothingRecorded';

const TEXT: Record<VoiceLang, Record<Key, string>> = {
  es: {
    help: 'Puedo decirte en qué nos quedamos, correr las pruebas o el typecheck, decirte si el vigía vio algo roto, listar o abrir prototipos, listar los checkpoints y revertir el último cambio. Di salir para terminar.',
    bye: 'Hasta luego.',
    notUnderstood: 'No te entendí. Di ayuda para ver lo que puedo hacer.',
    noRuns: 'Todavía no hay corridas registradas.',
    allGreen: 'Todo estaba en verde en la última corrida.',
    noPrototypes: 'No hay prototipos en este proyecto.',
    noCheckpoints: 'No hay cambios que se puedan revertir.',
    cancelled: 'Cancelado, no cambié nada.',
    confirmHint: 'Di sí para hacerlo o no para cancelar.',
    rollbackDone: 'Listo, revertí "{label}".',
    rollbackRefused: 'No lo revertí: {reason}',
    nothingRecorded: 'No hay trabajo previo registrado.',
  },
  en: {
    help: 'I can tell you where we left off, run the tests or the typecheck, tell you whether watch mode saw something broken, list or open prototypes, list checkpoints and undo the last change. Say exit to stop.',
    bye: 'Goodbye.',
    notUnderstood: "I didn't get that. Say help to hear what I can do.",
    noRuns: 'No checks have run yet.',
    allGreen: 'Everything was green at the last run.',
    noPrototypes: 'There are no prototypes in this project.',
    noCheckpoints: 'There is no change to undo.',
    cancelled: "Cancelled, I didn't change anything.",
    confirmHint: 'Say yes to do it or no to cancel.',
    rollbackDone: 'Done, I undid "{label}".',
    rollbackRefused: "I didn't undo it: {reason}",
    nothingRecorded: 'No previous work is recorded.',
  },
};

export function say(lang: VoiceLang, key: Key, vars: Record<string, string> = {}): string {
  return TEXT[lang][key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

/** Joins names naturally: "a, b y c" / "a, b and c". */
export function joinNames(items: string[], lang: VoiceLang): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${lang === 'es' ? 'y' : 'and'} ${items[items.length - 1]}`;
}
