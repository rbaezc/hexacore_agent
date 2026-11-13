import { Intent } from './voice_types.js';

/** Lower case, no accents or punctuation: "¿En qué nos quedamos?" → "en que nos quedamos". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CHECK_WORDS: [RegExp, string][] = [
  [/\b(typecheck|type check|tipos|tipado)\b/, 'typecheck'],
  [/\b(pruebas?|tests?|testing)\b/, 'test'],
  [/\b(lint|linter)\b/, 'lint'],
  [/\b(build|compila\w*|compile)\b/, 'build'],
];

function checksIn(text: string): string[] {
  return CHECK_WORDS.filter(([re]) => re.test(text)).map(([, check]) => check);
}

const RULES: { name: Intent['name']; re: RegExp }[] = [
  { name: 'exit', re: /^(salir|sal|adios|terminar|termina|hasta luego|exit|quit|bye|goodbye|stop listening)\b/ },
  { name: 'help', re: /\b(ayuda|que puedes hacer|que sabes hacer|comandos|help|what can you do)\b/ },
  { name: 'rollback_last', re: /\b(revierte\w*|rever[ts]\w*|deshaz|deshacer|deshace|undo|roll ?back)\b/ },
  { name: 'watch_status', re: /\b(vigia|watch|watcher|algo roto|esta roto|hay errores|anything broken|whats broken|what's broken|is something broken)\b/ },
  { name: 'list_checkpoints', re: /\b(checkpoints?|puntos de control|cambios recientes|recent changes)\b/ },
  {
    name: 'resume',
    re: /\b(en que nos quedamos|donde nos quedamos|en que estabamos|where did we leave off|where we left off|briefing|resumen|estado del proyecto|project status|que sigue|whats next|what's next)\b/,
  },
];

/** Maps a transcribed sentence (Spanish or English) to one of the supported commands. */
export function parseIntent(text: string): Intent | undefined {
  const t = normalize(text);
  if (!t) return undefined;
  for (const rule of RULES) if (rule.re.test(t)) return { name: rule.name };

  if (/\b(prototipos|prototypes)\b/.test(t) && !/\b(abre|abrir|open)\b/.test(t)) return { name: 'list_prototypes' };
  const proto = t.match(/\b(?:abre|abrir|muestra|muestrame|ensename|open|show)\b.*?\b(?:prototipo|prototype|preview)\b(?:\s+(?:de|del|la|el|called|named)\b)*\s*([a-z0-9][a-z0-9 -]*)?$/);
  if (proto) return { name: 'open_prototype', target: proto[1]?.trim().replace(/\s+/g, '-') || undefined };

  const checks = checksIn(t);
  const asksToRun = /\b(corre|correr|ejecuta|ejecutar|lanza|pasa|verifica|revisa|run|check|execute)\b/.test(t);
  if (asksToRun && (checks.length || /\b(todo|checks|qa|everything|all)\b/.test(t))) {
    return { name: 'run_checks', checks: checks.length ? checks : undefined };
  }
  if (checks.length && t.split(' ').length <= 3) return { name: 'run_checks', checks };
  return undefined;
}

/** Whether the intent changes files (and therefore needs a spoken yes first). */
export const writesFiles = (intent: Intent): boolean => intent.name === 'rollback_last';

export type Answer = 'yes' | 'no' | undefined;

export function parseAnswer(text: string): Answer {
  const t = normalize(text);
  if (/^(si|claro|adelante|hazlo|confirmo|dale|de acuerdo|ok|okay|yes|yeah|yep|sure|do it|go ahead|confirm)\b/.test(t)) return 'yes';
  if (/^(no|cancela|cancelar|mejor no|nope|cancel|never mind|nevermind)\b/.test(t)) return 'no';
  return undefined;
}
