import { ParsedReport, ReportFormat } from '../../domain/qa_types.js';

export function emptyReport(format: ReportFormat): ParsedReport {
  return { format, total: 0, passed: 0, failed: 0, skipped: 0, failures: [] };
}

export function firstLine(text: string | undefined | null): string {
  if (!text) return '';
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (line ?? '').slice(0, 500);
}

export function tail(text: string, maxChars: number = 6000): string {
  return text.length <= maxChars ? text : `…[${text.length - maxChars} chars truncated]…\n${text.slice(-maxChars)}`;
}

export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

export function parseXmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    attrs[m[1]] = decodeXmlEntities(m[2]);
  }
  return attrs;
}
