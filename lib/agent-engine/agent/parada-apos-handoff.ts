import type { ToolSet } from '../edge/llm/run-model-call';

/** A passagem confirmada encerra a fala deste turno, sem depender do modelo. */
export function criarParadaAposHandoff(tools: ToolSet) {
  let concluida = false;
  let fila: Promise<unknown> = Promise.resolve();
  const protegidas = { ...tools };

  for (const nome of ['request_human_handoff', 'send_message', 'send_template']) {
    const ferramenta = tools[nome];
    if (typeof ferramenta?.execute !== 'function') continue;
    const executar = ferramenta.execute;
    protegidas[nome] = {
      ...ferramenta,
      execute: (...args: Parameters<typeof executar>) => {
        // A fila também impede envios paralelos do mesmo passo após a passagem.
        const resultado = fila.then(async () => {
          if (concluida) {
            return {
              ok: false,
              error: {
                code: 'handoff_completed',
                message: 'A passagem humana já foi confirmada. Encerre o turno sem enviar outra mensagem.',
              },
            };
          }
          const retorno: unknown = await executar(...args);
          if (
            nome === 'request_human_handoff' &&
            typeof retorno === 'object' && retorno !== null &&
            'ok' in retorno && retorno.ok === true
          ) concluida = true;
          return retorno;
        });
        // A exceção continua no resultado do chamador; a fila admite o aviso de falha.
        fila = resultado.catch(() => undefined);
        return resultado;
      },
    };
  }

  return { tools: protegidas, pararQuando: () => concluida };
}
