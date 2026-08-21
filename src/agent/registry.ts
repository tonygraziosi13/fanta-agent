import type { AgentTool, ToolResult } from './types';
import { assignPlayerTool } from './tools/assignPlayer';
import { getConfigurationTool } from './tools/getConfiguration';
import { getOpponentsTool } from './tools/getOpponents';
import { importOpponentsTool } from './tools/importOpponents';
import { getPlayerDetailTool } from './tools/getPlayerDetail';
import { getWatchlistTool } from './tools/getWatchlist';
import { searchPlayersTool } from './tools/searchPlayers';
import { suggestWatchlistTool } from './tools/suggestWatchlist';
import { topDefendersModifierTool } from './tools/topDefendersModifier';

/**
 * Registro dei tool disponibili all'agente.
 *
 * Sprint 1 lo popola e lo rende eseguibile, ma nessuno lo invoca ancora: manca
 * il runtime LLM (Sprint 2). E' verificabile da subito via `executeTool`, che
 * e' il modo giusto di testare i tool — senza spendere un token.
 */

export const AGENT_TOOLS: ReadonlyArray<AgentTool<any, any>> = [
  searchPlayersTool,
  getPlayerDetailTool,
  getWatchlistTool,
  getConfigurationTool,
  getOpponentsTool,
  topDefendersModifierTool,
  suggestWatchlistTool,
  assignPlayerTool,
  importOpponentsTool,
];

/** Serializzazione per il campo `tools` di una richiesta LLM. */
export function getToolDefinitions() {
  return AGENT_TOOLS.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));
}

export function findTool(name: string): AgentTool<any, any> | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

/**
 * Esecuzione di un tool call.
 *
 * Non solleva mai: un errore va restituito al modello come dato, perche' possa
 * correggersi al turno successivo. Un'eccezione non gestita farebbe invece
 * crashare l'app durante una conversazione.
 */
export async function executeTool(
  name: string,
  input: unknown
): Promise<ToolResult<unknown>> {
  const tool = findTool(name);
  if (!tool) {
    return { ok: false, error: `Tool sconosciuto: "${name}".` };
  }

  try {
    const data = await tool.handler(input as never);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
