import { parseAnswer, parseIntent, writesFiles } from '../domain/intents.js';
import { CheckOutcome, checkName, describeChecks, joinNames, say } from '../domain/replies.js';
import { Intent, ToolCaller, VoiceLang, VoiceReply } from '../domain/voice_types.js';

export interface VoiceSessionDeps {
  tools: ToolCaller;
  lang: VoiceLang;
  /** Opens a URL in the user's browser. */
  open?: (url: string) => void;
}

const DEFAULT_CHECKS = ['typecheck', 'test'];

/**
 * Turns sentences into HexaCore tool calls and their results into short spoken answers.
 * Reads run straight away; anything that writes is described first and runs only after a "yes".
 * Rollbacks are never forced by voice: a refused rollback is reported, not retried.
 */
export class VoiceSession {
  private pending?: { run: () => Promise<VoiceReply> };

  constructor(private readonly deps: VoiceSessionDeps) {}

  get awaitingConfirmation(): boolean {
    return Boolean(this.pending);
  }

  async handle(text: string): Promise<VoiceReply> {
    const lang = this.deps.lang;
    if (this.pending) {
      const answer = parseAnswer(text);
      const pending = this.pending;
      this.pending = undefined;
      if (answer === 'yes') return pending.run();
      if (answer === 'no') return { text: say(lang, 'cancelled') };
      // Anything else cancels the pending change and is handled as a new command.
      const next = await this.handle(text);
      return { ...next, text: `${say(lang, 'cancelled')} ${next.text}` };
    }

    const intent = parseIntent(text);
    if (!intent) return { text: say(lang, 'notUnderstood') };
    try {
      return await this.dispatch(intent);
    } catch (error: any) {
      return { text: lang === 'es' ? `Algo falló: ${error.message}` : `Something failed: ${error.message}` };
    }
  }

  private async dispatch(intent: Intent): Promise<VoiceReply> {
    const lang = this.deps.lang;
    switch (intent.name) {
      case 'exit':
        return { text: say(lang, 'bye'), done: true };
      case 'help':
        return { text: say(lang, 'help') };
      case 'resume':
        return this.resume();
      case 'watch_status':
        return this.watchStatus();
      case 'run_checks':
        return this.runChecks(intent.checks ?? DEFAULT_CHECKS);
      case 'list_prototypes':
      case 'open_prototype':
        return this.prototypes(intent);
      case 'list_checkpoints':
        return this.checkpoints();
      case 'rollback_last':
        return this.proposeRollback(intent);
    }
  }

  private async tool(name: string, input: Record<string, unknown> = {}): Promise<any> {
    const res = await this.deps.tools.call(name, input);
    if (res.isFailure) throw res.error;
    return res.value;
  }

  private async resume(): Promise<VoiceReply> {
    const lang = this.deps.lang;
    const b = await this.tool('resume_session');
    const parts: string[] = [];
    const handoff = b.latestHandoff;
    if (handoff?.summary) parts.push(lang === 'es' ? `La última vez: ${handoff.summary}` : `Last time: ${handoff.summary}`);
    if (handoff?.nextSteps?.length) parts.push(lang === 'es' ? `Lo siguiente era: ${handoff.nextSteps[0]}` : `Next up was: ${handoff.nextSteps[0]}`);
    const plans = b.pendingPlans?.length ?? 0;
    if (plans) parts.push(lang === 'es' ? `Hay ${plans} ${plans === 1 ? 'plan' : 'planes'} sin terminar.` : `${plans} unfinished ${plans === 1 ? 'plan' : 'plans'}.`);
    const red = (b.lastQa ?? []).filter((q: any) => q.status === 'failed');
    if (red.length) parts.push(this.redSentence(red));
    const decision = b.recentDecisions?.[b.recentDecisions.length - 1];
    if (decision) parts.push(lang === 'es' ? `Última decisión: ${decision.title}.` : `Latest decision: ${decision.title}.`);
    return { text: parts.length ? parts.join(' ') : say(lang, 'nothingRecorded'), detail: b.briefing };
  }

  private redSentence(red: { check: string; failed: number; source?: string }[]): string {
    const lang = this.deps.lang;
    const names = joinNames(red.map((q) => `${checkName(q.check, lang)} (${q.failed})`), lang);
    const byWatch = red.some((q) => q.source === 'watch');
    return lang === 'es'
      ? `En rojo: ${names}${byWatch ? ', según el vigía' : ''}.`
      : `Failing: ${names}${byWatch ? ', as seen by watch mode' : ''}.`;
  }

  private async watchStatus(): Promise<VoiceReply> {
    const b = await this.tool('resume_session');
    const runs: { check: string; status: string; failed: number; source?: string; at: string }[] = b.lastQa ?? [];
    if (runs.length === 0) return { text: say(this.deps.lang, 'noRuns') };
    const red = runs.filter((q) => q.status === 'failed');
    return { text: red.length ? this.redSentence(red) : say(this.deps.lang, 'allGreen') };
  }

  private async runChecks(checks: string[]): Promise<VoiceReply> {
    const out = await this.tool('run_quality_assurance', { checks });
    const outcomes: CheckOutcome[] = (out.results ?? []).map((r: any) => ({
      check: r.check,
      status: r.status,
      failed: r.failedTestsCount,
      firstFile: r.failures?.find((f: any) => f.file)?.file,
    }));
    const first = (out.results ?? []).flatMap((r: any) => r.failures ?? [])[0];
    return { text: describeChecks(outcomes, this.deps.lang), detail: first ? `${first.file ?? ''}${first.line ? `:${first.line}` : ''} ${first.errorMessage}`.trim() : undefined };
  }

  private async prototypes(intent: Intent): Promise<VoiceReply> {
    const lang = this.deps.lang;
    const list = await this.tool('list_prototypes');
    const protos: { name: string; current: number; previewUrl?: string }[] = list.prototypes ?? [];
    if (protos.length === 0) return { text: say(lang, 'noPrototypes') };
    if (intent.name === 'list_prototypes') {
      const names = joinNames(protos.map((p) => p.name.replace(/-/g, ' ')), lang);
      return { text: lang === 'es' ? `Hay ${protos.length}: ${names}.` : `There are ${protos.length}: ${names}.` };
    }
    const wanted = intent.target;
    const proto = wanted ? protos.find((p) => p.name === wanted || p.name.includes(wanted)) : protos[0];
    if (!proto) return { text: lang === 'es' ? `No encontré el prototipo ${wanted}.` : `I couldn't find the prototype ${wanted}.` };
    if (!proto.previewUrl) return { text: lang === 'es' ? 'La vista previa está desactivada.' : 'Previews are turned off.' };
    this.deps.open?.(proto.previewUrl);
    return { text: lang === 'es' ? `Abriendo ${proto.name.replace(/-/g, ' ')}, versión ${proto.current}.` : `Opening ${proto.name.replace(/-/g, ' ')}, version ${proto.current}.`, detail: proto.previewUrl };
  }

  private async checkpoints(): Promise<VoiceReply> {
    const lang = this.deps.lang;
    const list: { label: string; status: string }[] = await this.tool('list_checkpoints');
    const open = list.filter((c) => c.status === 'open');
    if (open.length === 0) return { text: say(lang, 'noCheckpoints') };
    const latest = open[0];
    return {
      text:
        lang === 'es'
          ? `${open.length === 1 ? 'Hay 1 cambio que se puede' : `Hay ${open.length} cambios que se pueden`} revertir. El último: ${latest.label}.`
          : `${open.length === 1 ? '1 change' : `${open.length} changes`} can be undone. The latest: ${latest.label}.`,
      detail: open.slice(0, 5).map((c) => `- ${c.label}`).join('\n'),
    };
  }

  private async proposeRollback(intent: Intent): Promise<VoiceReply> {
    const lang = this.deps.lang;
    const list: { id: string; label: string; status: string; files?: string[] }[] = await this.tool('list_checkpoints');
    const latest = list.find((c) => c.status === 'open');
    if (!latest) return { text: say(lang, 'noCheckpoints') };
    const files = latest.files?.length ?? 0;
    if (writesFiles(intent)) {
      this.pending = {
        run: async () => {
          const res = await this.deps.tools.call('rollback_changes', { checkpointId: latest.id });
          if (res.isFailure) return { text: say(lang, 'rollbackRefused', { reason: res.error.message }) };
          return { text: say(lang, 'rollbackDone', { label: latest.label }) };
        },
      };
    }
    const question =
      lang === 'es'
        ? `Voy a revertir "${latest.label}", que tocó ${files} ${files === 1 ? 'archivo' : 'archivos'}. ¿Lo hago?`
        : `I'll undo "${latest.label}", which touched ${files} ${files === 1 ? 'file' : 'files'}. Shall I?`;
    return { text: question, detail: latest.files?.join('\n'), awaitingConfirmation: true };
  }
}
