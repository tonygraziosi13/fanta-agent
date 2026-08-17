import { SUPPORTED_SCHEMA, type DatasetManifest, type DatasetPayload } from './types';

/**
 * Validazione di cio' che arriva dalla rete.
 *
 * Perche' esiste, dato che c'e' TypeScript: i tipi svaniscono a runtime. Un
 * `JSON.parse` restituisce `any`, e un payload troncato a meta' download o un
 * 404 servito come pagina HTML passerebbero indisturbati fino a SQLite, dove il
 * danno e' gia' fatto e il messaggio d'errore non dice piu' nulla.
 *
 * Validazione *strutturale*, non pedante: si controlla che ci siano i campi
 * indispensabili a costruire un giocatore. I singoli campi metrica restano
 * liberi di essere null — e' la loro natura (vedi `playerStats.ts`).
 *
 * Puro e senza dipendenze: gira in Jest senza ambiente nativo.
 */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateManifest(raw: unknown): ValidationResult<DatasetManifest> {
  if (!isObject(raw)) return { ok: false, error: 'Manifest non è un oggetto JSON.' };

  const { version, hash, payload, players_count } = raw;
  if (typeof version !== 'string' || version === '') {
    return { ok: false, error: 'Manifest senza `version`.' };
  }
  // L'hash e' l'unica cosa che rende affidabile il confronto di versione: senza,
  // non si puo' decidere se scaricare, e si finirebbe per scaricare sempre.
  if (typeof hash !== 'string' || hash === '') {
    return { ok: false, error: 'Manifest senza `hash`.' };
  }
  if (typeof payload !== 'string' || payload === '') {
    return { ok: false, error: 'Manifest senza riferimento al payload.' };
  }

  return {
    ok: true,
    value: {
      version,
      hash,
      payload,
      season: typeof raw.season === 'string' ? raw.season : '',
      generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : '',
      players_count: typeof players_count === 'number' ? players_count : 0,
      size_bytes: typeof raw.size_bytes === 'number' ? raw.size_bytes : 0,
    },
  };
}

export function validatePayload(raw: unknown): ValidationResult<DatasetPayload> {
  if (!isObject(raw)) return { ok: false, error: 'Payload non è un oggetto JSON.' };

  const schema = raw.schema;
  if (typeof schema !== 'number') {
    return { ok: false, error: 'Payload senza versione di schema.' };
  }
  // Un payload piu' recente di quanto l'app sappia leggere va rifiutato, non
  // interpretato a meta': meglio restare sui dati vecchi e funzionanti.
  if (schema > SUPPORTED_SCHEMA) {
    return {
      ok: false,
      error: `Schema ${schema} non supportato (questa versione legge fino a ${SUPPORTED_SCHEMA}). Aggiorna l'app.`,
    };
  }

  const players = raw.players;
  if (!Array.isArray(players)) {
    return { ok: false, error: 'Payload senza elenco `players`.' };
  }
  // Un elenco vuoto e' quasi certamente una generazione andata male a monte.
  // Applicarlo spegnerebbe l'intero listone dell'utente.
  if (players.length === 0) {
    return { ok: false, error: 'Payload con zero giocatori: rifiutato.' };
  }

  return {
    ok: true,
    value: {
      schema,
      players: players as DatasetPayload['players'],
      season: typeof raw.season === 'string' ? raw.season : '',
      generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : '',
      sources: isObject(raw.sources) ? raw.sources : {},
    },
  };
}
