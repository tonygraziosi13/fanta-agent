/**
 * Contratto dei tool dell'agente.
 *
 * Stato in Sprint 1: SCAFFOLDING. Nessuna chiamata di rete, nessuna API key,
 * nessun runtime LLM — quello e' Sprint 2. Qui si fissa solo la forma, perche'
 * definirla ora costringe a tenere la logica di dominio fuori dai componenti:
 * un tool che non riesce a rispondere senza montare una schermata segnala che
 * quella logica sta nel posto sbagliato.
 *
 * `input_schema` e' JSON Schema: forma provider-agnostica, gia' compatibile con
 * il formato tool-use delle principali API LLM. Quando si collegherà un client
 * reale, i tool qui registrati si serializzano senza adattatori.
 */

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  /** Descrizione letta dal modello per decidere se invocare il tool. */
  description: string;
  input_schema: JsonSchema;
  /** Esecuzione lato app. Legge lo stato in memoria o passa dalla pipeline. */
  handler: (input: TInput) => Promise<TOutput> | TOutput;
  /**
   * true = il tool modifica lo stato dell'utente.
   * In Sprint 2 questi richiederanno conferma esplicita prima dell'esecuzione:
   * un agente non deve poter riscrivere la watchlist senza che l'utente lo sappia.
   */
  mutating?: boolean;
}

export interface ToolResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
