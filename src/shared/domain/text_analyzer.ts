/**
 * Bilingual (English/Spanish) analyzer for the rule corpus: accent folding, stop words,
 * a light suffix stemmer and a small domain synonym map. Deliberately simple — the corpus
 * is a few hundred sections, so recall matters more than linguistic precision.
 */

const STOP_WORDS = new Set([
  // English
  'the', 'and', 'for', 'with', 'that', 'this', 'are', 'from', 'into', 'must', 'should', 'not', 'any', 'all', 'each', 'its', 'via', 'use', 'per', 'how', 'what', 'when', 'can',
  // Spanish
  'el', 'la', 'los', 'las', 'de', 'del', 'en', 'un', 'una', 'unos', 'unas', 'que', 'por', 'para', 'con', 'sin', 'como', 'se', 'su', 'sus', 'al', 'es', 'son', 'lo', 'mas', 'o', 'y', 'debe', 'deben', 'cada', 'cual', 'cuando',
]);

/** Natural-language synonyms → canonical word; both sides are stemmed below so inflections match too. */
const SYNONYM_WORDS: Record<string, string> = {
  bd: 'database',
  db: 'database',
  datos: 'database',
  tabla: 'table',
  prueba: 'test',
  testing: 'test',
  spec: 'test',
  rebanada: 'slice',
  feature: 'slice',
  funcionalidad: 'slice',
  capa: 'layer',
  dominio: 'domain',
  aplicacion: 'application',
  infraestructura: 'infrastructure',
  presentacion: 'presentation',
  controlador: 'controller',
  repositorio: 'repository',
  servicio: 'service',
  excepcion: 'error',
  exception: 'error',
  transaccion: 'transaction',
  indice: 'index',
  llave: 'key',
  clave: 'key',
  foranea: 'foreign',
  linea: 'line',
  archivo: 'file',
  acoplamiento: 'coupling',
  dependencia: 'dependency',
  evento: 'event',
  contrato: 'contract',
  regla: 'rule',
  convencion: 'convention',
  seguridad: 'security',
  validacion: 'validation',
};

export function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Strips common English/Spanish inflections. Order matters: longest suffixes first. */
export function stem(token: string): string {
  if (token.length <= 3 || /\d/.test(token)) return token;
  const rules: [RegExp, string][] = [
    [/(aciones|iciones)$/, 'acion'],
    [/(mente)$/, ''],
    [/(ations?)$/, 'ate'],
    [/(ization)$/, 'ize'],
    [/(ing|ed)$/, ''],
    [/(ies)$/, 'y'],
    [/(es)$/, ''],
    [/(s)$/, ''],
    [/(e)$/, ''],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(token)) {
      const stemmed = token.replace(pattern, replacement);
      if (stemmed.length >= 3) return stemmed;
    }
  }
  return token;
}

const SYNONYMS: Map<string, string> = new Map(Object.entries(SYNONYM_WORDS).map(([from, to]) => [stem(from), stem(to)]));

export function analyze(text: string): string[] {
  return foldAccents(text.toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
    .map((t) => {
      const s = stem(t);
      return SYNONYMS.get(s) ?? s;
    });
}
