import { compose, withRetry, withTimeout, type Wrapper } from '@/agent/middleware/wrap';
import { GroqError, withKeyRotation } from '@/agent/llm/groqClient';
import { KeyRing } from '@/agent/llm/keyRing';
import type { ChatRequest, ChatResponse } from '@/agent/llm/groqClient';

/**
 * Rotazione delle chiavi e avvolgimenti dinamici (Fase 2), senza rete.
 *
 * È la parte dove un difetto non solleva niente: una rotazione che non ruota
 * sembra "Groq è lento", e un ciclo infinito sembra "l'app si è piantata".
 * Nessuno dei due si scopre leggendo il codice.
 */

function risposta(key: string): ChatResponse {
  return { content: `ok:${key}`, toolCalls: [], model: 'test', keyIndex: -1 };
}

/** Un finto `next` che risponde secondo il copione, chiave per chiave. */
function copione(esiti: Record<string, 'ok' | GroqError>) {
  const chiamate: string[] = [];

  const next = async (input: ChatRequest): Promise<ChatResponse> => {
    const key = (input as ChatRequest & { __apiKey?: string }).__apiKey ?? '';
    chiamate.push(key);
    const esito = esiti[key];
    if (esito instanceof GroqError) throw esito;
    return risposta(key);
  };

  return { next, chiamate };
}

const rateLimit = (retryAfterMs: number | null = null) =>
  new GroqError('rate limit', 429, 'rate_limit_exceeded', retryAfterMs);
const revocata = () => new GroqError('invalid api key', 401);

describe('KeyRing', () => {
  it('la chiave attiva sopravvive fra una chiamata e l’altra', () => {
    /**
     * Se ogni richiesta ripartisse dalla prima, quella esaurita verrebbe
     * ricolpita ogni volta: si pagherebbe un 429 per richiesta prima di
     * arrivare a una chiave viva, e avere cinque chiavi non servirebbe a nulla.
     */
    const ring = new KeyRing(['a', 'b', 'c']);

    expect(ring.current()).toBe('a');
    ring.advance();
    expect(ring.current()).toBe('b');
    expect(ring.current()).toBe('b');
  });

  it('scarta le chiavi vuote e ripulisce gli spazi', () => {
    /** Una chiave copiata male dalla console darebbe un 401 indistinguibile da
     * una revoca vera. */
    expect(new KeyRing([' a ', '', '   ', 'b']).size).toBe(2);
  });

  it('una chiave revocata esce dal giro', () => {
    const ring = new KeyRing(['a', 'b']);
    ring.revoke('a');

    expect(ring.disponibili).toBe(1);
    expect(ring.current()).toBe('b');
  });

  it('esaurite tutte, non restituisce niente invece di ciclare', () => {
    const ring = new KeyRing(['a', 'b']);
    ring.revoke('a');
    ring.revoke('b');

    expect(ring.current()).toBeNull();
    expect(ring.advance()).toBeNull();
  });
});

describe('withKeyRotation', () => {
  it('su 429 passa alla chiave successiva e riesce', async () => {
    const ring = new KeyRing(['a', 'b']);
    const { next, chiamate } = copione({ a: rateLimit(), b: 'ok' });

    const risultato = await withKeyRotation(ring)({ messages: [] }, next);

    expect(chiamate).toEqual(['a', 'b']);
    expect(risultato.content).toBe('ok:b');
  });

  it('su 401 toglie la chiave dal giro invece di riprovarla', async () => {
    /**
     * Una chiave revocata non si risolve ritentando: lasciata in rotazione
     * verrebbe ricolpita a ogni ciclo, sembrando un rate limit permanente.
     */
    const ring = new KeyRing(['a', 'b']);
    const { next } = copione({ a: revocata(), b: 'ok' });

    await withKeyRotation(ring)({ messages: [] }, next);

    expect(ring.disponibili).toBe(1);
    expect(ring.revocateCount).toBe(1);
  });

  it('con tutte le chiavi esaurite fallisce invece di ciclare all’infinito', async () => {
    /**
     * Il tetto al numero di tentativi. Senza, cinque chiavi finite diventano un
     * ciclo infinito su un telefono in mano a qualcuno che sta partecipando a
     * un'asta.
     */
    const ring = new KeyRing(['a', 'b', 'c']);
    const { next, chiamate } = copione({ a: rateLimit(), b: rateLimit(), c: rateLimit() });

    await expect(withKeyRotation(ring)({ messages: [] }, next)).rejects.toThrow(GroqError);
    expect(chiamate).toHaveLength(3);
  });

  it('non aspetta il Retry-After finché c’è un’altra chiave', async () => {
    /**
     * Averne cinque serve esattamente a non aspettare: attendere prima di
     * ruotare vanificherebbe la rotazione. Sessanta secondi di attesa in asta
     * sono un giocatore già venduto.
     */
    const ring = new KeyRing(['a', 'b']);
    const { next } = copione({ a: rateLimit(60_000), b: 'ok' });

    const inizio = Date.now();
    await withKeyRotation(ring)({ messages: [] }, next);

    expect(Date.now() - inizio).toBeLessThan(1_000);
  });

  it('un modello ritirato esce subito: cambiare chiave non lo riporta in vita', async () => {
    const ring = new KeyRing(['a', 'b', 'c']);
    const dismesso = new GroqError('decommissioned', 400, 'model_decommissioned');
    const { next, chiamate } = copione({ a: dismesso, b: 'ok', c: 'ok' });

    await expect(withKeyRotation(ring)({ messages: [] }, next)).rejects.toThrow(/decommissioned/);
    expect(chiamate).toEqual(['a']);
  });

  it('senza nemmeno una chiave lo dice chiaramente', async () => {
    const { next } = copione({});

    await expect(
      withKeyRotation(new KeyRing([]))({ messages: [] }, next)
    ).rejects.toThrow(/Nessuna chiave Groq configurata/);
  });
});

describe('compose', () => {
  it('il primo dichiarato è il più esterno', async () => {
    /**
     * L'ordine di dichiarazione è l'ordine di esecuzione: è l'unica convenzione
     * che non si sbaglia rileggendo il codice sei mesi dopo.
     */
    const tracce: string[] = [];
    const traccia =
      (nome: string): Wrapper<number, number> =>
      async (input, next) => {
        tracce.push(`${nome}:entra`);
        const out = await next(input);
        tracce.push(`${nome}:esce`);
        return out;
      };

    await compose(traccia('esterno'), traccia('interno'))(1, async (n) => n);

    expect(tracce).toEqual([
      'esterno:entra',
      'interno:entra',
      'interno:esce',
      'esterno:esce',
    ]);
  });

  it('senza avvolgimenti chiama direttamente', async () => {
    expect(await compose<number, number>()(41, async (n) => n + 1)).toBe(42);
  });
});

describe('withTimeout', () => {
  it('interrompe quel che non risponde in tempo', async () => {
    const lento: Wrapper<number, number> = withTimeout(50);
    // Il timer del *finto lento* va ripulito a mano: `withTimeout` chiude il
    // proprio, non quello di chi avvolge. Senza, Jest resta appeso cinque
    // secondi dopo che il test è già passato — che è esattamente il difetto
    // contro cui il `finally` di `withTimeout` protegge il codice di produzione.
    let handle: ReturnType<typeof setTimeout> | undefined;

    try {
      await expect(
        lento(1, () => new Promise((r) => {
          handle = setTimeout(() => r(1), 5_000);
        }))
      ).rejects.toThrow(/Nessuna risposta entro 50ms/);
    } finally {
      if (handle !== undefined) clearTimeout(handle);
    }
  });

  it('lascia passare quel che risponde in tempo', async () => {
    expect(await withTimeout<number, number>(1_000)(41, async (n) => n + 1)).toBe(42);
  });
});

describe('withRetry', () => {
  it('ritenta solo gli errori dichiarati ritentabili', async () => {
    let tentativi = 0;
    const wrapper = withRetry<number, number>(3, (e) => (e as Error).message === 'rete', 1);

    const risultato = await wrapper(1, async () => {
      tentativi += 1;
      if (tentativi < 3) throw new Error('rete');
      return tentativi;
    });

    expect(risultato).toBe(3);
  });

  it('un errore non ritentabile esce al primo colpo', async () => {
    let tentativi = 0;
    const wrapper = withRetry<number, number>(3, () => false, 1);

    await expect(
      wrapper(1, async () => {
        tentativi += 1;
        throw new Error('definitivo');
      })
    ).rejects.toThrow('definitivo');
    expect(tentativi).toBe(1);
  });
});
