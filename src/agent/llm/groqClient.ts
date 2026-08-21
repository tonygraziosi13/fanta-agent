import { compose, withTimeout, type Wrapper } from '../middleware/wrap';
import { apiKeys, baseUrl, modelComplex } from './config';
import { KeyRing } from './keyRing';

/**
 * Client Groq, API compatibile OpenAI.
 *
 * Nessuna dipendenza: `fetch` esiste su React Native, e un SDK per una sola
 * chiamata POST sarebbe un megabyte di bundle per risparmiare venti righe.
 *
 * La rotazione delle chiavi non e' dentro il client ma e' un **avvolgimento**
 * (Fase 2): il client sa fare una chiamata con *una* chiave, e chi lo avvolge
 * decide cosa fare quando quella chiave e' finita. La separazione permette di
 * testare la rotazione senza rete e il client senza rotazione.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  tools?: unknown[];
  /** Forza una risposta JSON: utile alla Fase 3, che deve validarla. */
  jsonMode?: boolean;
}

export interface ChatResponse {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  model: string;
  /** Chiave usata, per diagnostica. Mai il valore: solo la posizione nel giro. */
  keyIndex: number;
}

export class GroqError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null = null,
    readonly retryAfterMs: number | null = null
  ) {
    super(message);
    this.name = 'GroqError';
  }

  /** Quota esaurita per questa chiave: si cambia chiave, non si aspetta. */
  get isRateLimit(): boolean {
    return this.status === 429 || this.code === 'rate_limit_exceeded';
  }

  /** Chiave non valida o revocata: ritentare non serve, va tolta dal giro. */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /**
   * Modello ritirato. Merita un caso suo perche' e' l'errore piu' probabile
   * alla prima esecuzione: Groq dismette i modelli con poco preavviso, e il
   * messaggio generico manderebbe a cercare il problema nelle chiavi.
   */
  get isModelGone(): boolean {
    return this.code === 'model_decommissioned' || this.code === 'model_not_found';
  }
}

/** Una chiamata con una chiave data. Non ritenta e non ruota: e' il livello sotto. */
export async function chatOnce(
  request: ChatRequest,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<ChatResponse> {
  const response = await fetchImpl(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: request.model ?? modelComplex(),
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      ...(request.tools ? { tools: request.tools } : {}),
      ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!response.ok) {
    throw await toGroqError(response);
  }

  const payload = (await response.json()) as GroqPayload;
  const choice = payload.choices?.[0];

  return {
    content: choice?.message?.content ?? '',
    toolCalls: (choice?.message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
    model: payload.model ?? request.model ?? modelComplex(),
    keyIndex: -1,
  };
}

async function toGroqError(response: Response): Promise<GroqError> {
  let code: string | null = null;
  let messaggio = `HTTP ${response.status}`;

  try {
    const body = (await response.json()) as { error?: { message?: string; code?: string } };
    code = body.error?.code ?? null;
    messaggio = body.error?.message ?? messaggio;
  } catch {
    // Un corpo non-JSON e' comunque un errore: il codice HTTP basta a decidere.
  }

  const retryAfter = response.headers.get('retry-after');
  return new GroqError(
    messaggio,
    response.status,
    code,
    retryAfter ? Number(retryAfter) * 1000 : null
  );
}

/**
 * L'avvolgimento che ruota le chiavi (Fase 2).
 *
 * Tre regole, e ognuna evita un modo diverso di fallire:
 *
 *   **Il giro e' limitato al numero di chiavi.** Senza il tetto, cinque chiavi
 *   esaurite diventano un ciclo infinito su un telefono in mano a qualcuno che
 *   sta partecipando a un'asta.
 *
 *   **`Retry-After` si onora solo se non resta altra chiave.** Averne cinque
 *   serve esattamente a non aspettare: attendere prima di ruotare vanificherebbe
 *   la rotazione.
 *
 *   **401 non e' 429.** Una chiave revocata si toglie dal giro invece di essere
 *   riprovata al ciclo successivo, dove sembrerebbe un rate limit permanente.
 */
export function withKeyRotation(ring: KeyRing): Wrapper<ChatRequest, ChatResponse> {
  return async (input, next) => {
    if (ring.size === 0) {
      throw new GroqError(
        'Nessuna chiave Groq configurata (expo.extra.groqApiKeys).',
        null
      );
    }

    let ultimo: unknown;

    // Un tentativo per chiave: oltre, si starebbe ricominciando il giro.
    for (let tentativo = 0; tentativo < ring.size; tentativo += 1) {
      const key = ring.current();
      if (key === null) break;

      try {
        const risposta = await next({ ...input, __apiKey: key } as ChatRequest);
        return risposta;
      } catch (error) {
        ultimo = error;
        if (!(error instanceof GroqError)) throw error;

        if (error.isAuth) {
          ring.revoke(key);
          continue;
        }

        if (error.isRateLimit) {
          const prossima = ring.advance();
          // Solo quando il giro e' esaurito ha senso aspettare: con un'altra
          // chiave disponibile, attendere sarebbe tempo regalato.
          if (prossima === null || ring.disponibili <= 1) {
            if (error.retryAfterMs !== null) {
              await new Promise((r) => setTimeout(r, error.retryAfterMs!));
            }
          }
          continue;
        }

        // Modello ritirato, richiesta malformata, 500: cambiare chiave non
        // cambia l'esito. Si esce subito con l'errore vero.
        throw error;
      }
    }

    throw ultimo instanceof Error
      ? ultimo
      : new GroqError('Tutte le chiavi Groq sono esaurite o revocate.', 429);
  };
}

/**
 * Il client pronto all'uso: rotazione dentro un timeout.
 *
 * L'ordine conta. Il timeout e' **esterno**, quindi copre l'intero giro delle
 * chiavi: al contrario ripartirebbe da capo a ogni chiave, e cinque chiavi lente
 * diventerebbero cinque attese intere prima di arrendersi.
 */
export function createGroqClient(options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
  const ring = new KeyRing(apiKeys());
  const fetchImpl = options.fetchImpl ?? fetch;

  const wrapper = compose<ChatRequest, ChatResponse>(
    withTimeout(options.timeoutMs ?? 30_000),
    withKeyRotation(ring)
  );

  return {
    ring,
    chat: (request: ChatRequest): Promise<ChatResponse> =>
      wrapper(request, (req) => {
        // La chiave viaggia nell'input perche' e' l'avvolgimento a sceglierla:
        // il client sottostante non deve sapere che esiste una rotazione.
        const { __apiKey, ...pulita } = req as ChatRequest & { __apiKey?: string };
        return chatOnce(pulita, __apiKey ?? '', fetchImpl);
      }),
  };
}

interface GroqPayload {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
}
