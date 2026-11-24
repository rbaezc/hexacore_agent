import { afterEach, describe, expect, it } from 'vitest';
import { createToolRegistry } from '../../src/features/mcp_server/infrastructure/mcp_server_factory.js';
import { createTestHexaCore } from '../helpers/test_hexacore.js';

const ctx = {} as any;

function setup(testFailures: number[] = [0]) {
  const { services } = createTestHexaCore(testFailures);
  return { services, registry: createToolRegistry(services) };
}

afterEach(() => {
  delete process.env.HEXACORE_AGENT;
});

describe('agent attribution', () => {
  it('offers `agent` on every tool', () => {
    const { registry } = setup();
    for (const tool of registry.listTools(['node'])) {
      expect((tool.inputSchema as any).properties.agent, tool.name).toBeDefined();
    }
  });

  it('records which agent made a checkpoint and ran a check', async () => {
    const { services, registry } = setup();
    const scaffold = await registry.call('execute_scaffolding', { stack: 'node', sliceName: 'refunds', agent: 'dev' }, ctx);
    expect(scaffold.isSuccess).toBe(true);
    const qa = await registry.call('run_quality_assurance', { stack: 'node', agent: 'qa' }, ctx);
    expect(qa.isSuccess).toBe(true);

    const [checkpoint] = await services.journal.list(1);
    expect(checkpoint.agent).toBe('dev');
    const state = await services.stateRepo.loadState();
    expect(state.isSuccess && state.value.qaHistory.at(-1)?.agent).toBe('qa');
  });

  it('falls back to HEXACORE_AGENT for a whole process', async () => {
    process.env.HEXACORE_AGENT = 'e2e';
    const { services, registry } = setup();
    await registry.call('run_quality_assurance', { stack: 'node' }, ctx);
    const state = await services.stateRepo.loadState();
    expect(state.isSuccess && state.value.qaHistory.at(-1)?.agent).toBe('e2e');
  });

  it('rejects an agent name that is not a short identifier', async () => {
    const { registry } = setup();
    const res = await registry.call('resume_session', { agent: 'qa; rm -rf /' }, ctx);
    expect(res.isFailure).toBe(true);
  });

  it('hands work from one role to another and shows it to that role first', async () => {
    const { registry } = setup();
    const handoff = await registry.call('record_handoff', { summary: 'refunds slice ready', nextSteps: ['verify refunds'], to: 'qa', agent: 'dev' }, ctx);
    expect(handoff.isSuccess && (handoff.value as any)).toMatchObject({ from: 'dev', to: 'qa' });

    const forQa = await registry.call('resume_session', { agent: 'qa' }, ctx);
    expect(forQa.isSuccess).toBe(true);
    const briefing = forQa.value as any;
    expect(briefing.handoffsForYou.map((h: any) => h.summary)).toEqual(['refunds slice ready']);
    expect(briefing.briefing).toMatch(/For you \(qa\) from dev .*refunds slice ready/);

    const forE2e = (await registry.call('resume_session', { agent: 'e2e' }, ctx)).value as any;
    expect(forE2e.handoffsForYou).toEqual([]);

    // Once qa hands over in turn, the dev handoff is no longer pending for it.
    await registry.call('record_handoff', { summary: 'refunds verified', to: 'e2e', agent: 'qa' }, ctx);
    const again = (await registry.call('resume_session', { agent: 'qa' }, ctx)).value as any;
    expect(again.handoffsForYou).toEqual([]);
    const forE2eNow = (await registry.call('resume_session', { agent: 'e2e' }, ctx)).value as any;
    expect(forE2eNow.handoffsForYou.map((h: any) => h.from)).toEqual(['qa']);
  });
});
