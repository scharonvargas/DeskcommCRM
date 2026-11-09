import { generateText, stepCountIs, tool, type ToolSet } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createFakeRegistry } from '../edge/llm/providers';
import { criarParadaAposHandoff } from './parada-apos-handoff';

function bancada(handoff = async (): Promise<unknown> => ({ ok: true })) {
  const enviar = vi.fn(async () => ({ ok: true, status: 'enviada' }));
  const passar = vi.fn(handoff);
  const toolDe = (execute: () => Promise<unknown>) => tool({ inputSchema: z.object({}), execute });
  const originais: ToolSet = {
    request_human_handoff: toolDe(passar),
    send_message: toolDe(enviar),
    send_template: toolDe(enviar),
    get_lead_context: toolDe(async () => ({ ok: true })),
  };
  const parada = criarParadaAposHandoff(originais);
  const executar = (nome: string) => {
    const ferramenta = parada.tools[nome];
    if (!ferramenta?.execute) throw new Error(`ferramenta ausente: ${nome}`);
    return ferramenta.execute({}, { toolCallId: nome, messages: [], context: undefined });
  };
  return { ...parada, enviar, passar, executar, originais };
}

describe('passagem humana encerra a fala do turno', () => {
  it('aviso do sistema é seguido de zero novas confirmações, inclusive por template', async () => {
    const b = bancada();
    expect(b.pararQuando()).toBe(false);
    await b.executar('request_human_handoff');
    for (const nome of ['send_message', 'send_message', 'send_template', 'request_human_handoff']) {
      await expect(b.executar(nome)).resolves.toMatchObject({ ok: false, error: { code: 'handoff_completed' } });
    }
    expect(b.pararQuando()).toBe(true);
    expect(b.enviar).not.toHaveBeenCalled();
    expect(b.passar).toHaveBeenCalledTimes(1);
    expect(b.tools.get_lead_context).toBe(b.originais.get_lead_context);
  });

  it('serializa handoff e envios pedidos em paralelo no mesmo passo', async () => {
    let confirmar!: (value: unknown) => void;
    const b = bancada(() => new Promise((resolve) => { confirmar = resolve; }));
    const handoff = b.executar('request_human_handoff');
    const mensagem = b.executar('send_message');
    const template = b.executar('send_template');
    await Promise.resolve();
    expect(b.enviar).not.toHaveBeenCalled();
    expect(b.pararQuando()).toBe(false);
    confirmar({ ok: true });
    await handoff;
    for (const envio of [mensagem, template]) {
      await expect(envio).resolves.toMatchObject({ ok: false });
    }
    expect(b.enviar).not.toHaveBeenCalled();
  });

  it('preserva a mensagem anterior e bloqueia somente o que vem depois do sucesso', async () => {
    const b = bancada();
    await Promise.all([b.executar('send_message'), b.executar('request_human_handoff'), b.executar('send_template')]);
    expect(b.enviar).toHaveBeenCalledTimes(1);
    expect(b.pararQuando()).toBe(true);
  });

  it('payload recusado permite informar falha e tentar a passagem novamente', async () => {
    const b = bancada(async () => ({ ok: false, error: { code: 'invalid_payload' } }));
    await b.executar('request_human_handoff');
    expect(b.pararQuando()).toBe(false);
    await b.executar('send_message');
    b.passar.mockResolvedValueOnce({ ok: true });
    await b.executar('request_human_handoff');
    expect(b.pararQuando()).toBe(true);
    expect(b.enviar).toHaveBeenCalledTimes(1);
  });

  it('exceção chega ao chamador sem bloquear o aviso de falha', async () => {
    const b = bancada(async () => { throw new Error('indisponível'); });
    const handoff = b.executar('request_human_handoff');
    const envio = b.executar('send_message');
    await expect(handoff).rejects.toThrow('indisponível');
    await expect(envio).resolves.toMatchObject({ ok: true });
    expect(b.pararQuando()).toBe(false);
  });

  it('a trava é por turno: outra recepção continua respondendo', async () => {
    const anterior = bancada();
    await anterior.executar('request_human_handoff');
    const novo = bancada();
    await novo.executar('send_message');
    await novo.executar('send_message');
    expect(novo.enviar).toHaveBeenCalledTimes(2);
    expect(novo.pararQuando()).toBe(false);
  });

  it('o SDK real não chama o modelo de novo após a passagem confirmada', async () => {
    const b = bancada();
    let chamadas = 0;
    const factory = createFakeRegistry(async () => {
      chamadas += 1;
      return {
        content: [{ type: 'tool-call' as const, toolCallId: `c${chamadas}`, toolName: chamadas === 1 ? 'request_human_handoff' : 'send_message', input: '{}' }],
        finishReason: { unified: 'tool-calls' as const, raw: undefined },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
        warnings: [],
      };
    }).anthropic;
    if (!factory) throw new Error('provedor fictício ausente');
    await generateText({ model: factory('k', 'm'), prompt: 'quero falar com uma pessoa', tools: b.tools, stopWhen: [stepCountIs(4), b.pararQuando] });
    expect(chamadas).toBe(1);
    expect(b.enviar).not.toHaveBeenCalled();
  });
});
