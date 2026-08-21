import Constants from 'expo-constants';

/**
 * Configurazione dell'accesso a Groq.
 *
 * --- DOVE VANNO LE CHIAVI, E DOVE NON VANNO ---
 * In `.env`, che e' gitignorato:
 *
 *     EXPO_PUBLIC_GROQ_API_KEYS=gsk_prima,gsk_seconda,gsk_terza
 *
 * **Non in `app.json`.** Quel file e' versionato e questo repository e'
 * pubblico: una chiave committata li' finisce su GitHub, dove i bot che
 * scandagliano i commit la raccolgono in pochi minuti. E' un ordine di
 * grandezza peggio di "estraibile dall'APK".
 *
 * --- Restano comunque dentro il bundle ---
 * Il prefisso `EXPO_PUBLIC_` dice esattamente questo: la variabile viene
 * inlineata nel pacchetto a tempo di build. Non c'e' modo di chiamare un'API
 * dal dispositivo senza portarci la credenziale — `.env` toglie il segreto da
 * *git*, non dall'APK.
 *
 * Per una build personale e' accettabile: le chiavi Groq gratuite si revocano
 * dalla console in un istante e il costo di un abuso e' un rate limit, non una
 * fattura. Restano due conseguenze pratiche: **l'APK non si condivide**, e se
 * esce di mano le chiavi si revocano.
 *
 * Per una distribuzione vera servirebbe un proxy lato server, oppure chiavi
 * inserite a runtime e conservate in `expo-secure-store`: entrambe tolgono il
 * segreto dal pacchetto, che e' l'unica soluzione davvero risolutiva.
 */

interface GroqExtra {
  groqApiKeys?: string[] | string;
  groqModelComplex?: string;
  groqModelFast?: string;
  groqBaseUrl?: string;
}

function extra(): GroqExtra {
  return (Constants.expoConfig?.extra ?? {}) as GroqExtra;
}

/**
 * Le chiavi, come array.
 *
 * Si legge **prima `.env`** e solo dopo `app.json`: l'ordine non e' un
 * dettaglio, e' cio' che rende il percorso sicuro anche quello predefinito.
 * Chi segue il primo suggerimento che trova non finisce per committare un
 * segreto.
 *
 * Il fallback su `extra` resta per chi lavora su un repository privato, dove
 * `app.json` e' un posto legittimo.
 */
export function apiKeys(): string[] {
  const daEnv = process.env.EXPO_PUBLIC_GROQ_API_KEYS;
  if (typeof daEnv === 'string' && daEnv.trim() !== '') {
    return daEnv.split(',');
  }

  const raw = extra().groqApiKeys;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return raw.split(',');
  return [];
}

export function baseUrl(): string {
  return extra().groqBaseUrl ?? 'https://api.groq.com/openai/v1';
}

/**
 * I modelli, **configurabili e non scritti nel codice**.
 *
 * Groq dismette i modelli con un preavviso breve: `llama-3.1-70b-versatile`,
 * che compare in molta documentazione, non e' piu' servito e risponde
 * `model_decommissioned`. Tenerli in `app.json` significa che un ritiro si
 * risolve cambiando una riga di configurazione invece di ricompilare la logica.
 *
 * I default qui sotto vanno **verificati sulla console Groq** prima della prima
 * chiamata vera: sono l'ipotesi migliore al momento della scrittura, non una
 * garanzia.
 */
export function modelComplex(): string {
  return (
    process.env.EXPO_PUBLIC_GROQ_MODEL_COMPLEX ??
    extra().groqModelComplex ??
    'llama-3.3-70b-versatile'
  );
}

export function modelFast(): string {
  return (
    process.env.EXPO_PUBLIC_GROQ_MODEL_FAST ??
    extra().groqModelFast ??
    'llama-3.1-8b-instant'
  );
}

/** `false` quando non c'e' nemmeno una chiave: la UI puo' nascondere l'agente. */
export function isConfigured(): boolean {
  return apiKeys().length > 0;
}
