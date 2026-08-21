import Constants from 'expo-constants';

/**
 * Configurazione dell'accesso a Groq.
 *
 * --- AVVERTENZA SULLE CHIAVI ---
 * Un'applicazione Expo **impacchetta `expo.extra` dentro il bundle**. Le chiavi
 * qui sotto sono quindi estraibili da chiunque abbia l'APK, con un `strings`.
 *
 * E' una scelta consapevole per una build personale: le chiavi Groq del piano
 * gratuito sono revocabili dalla console in un istante, e il costo di un abuso
 * e' un rate limit, non una fattura. Le due conseguenze pratiche, pero', vanno
 * ricordate:
 *
 *   - **l'APK non si condivide**;
 *   - se esce di mano, si revocano le chiavi dalla console Groq.
 *
 * Se un giorno l'app dovesse essere distribuita, la strada e' un proxy lato
 * server oppure chiavi inserite a runtime e conservate in `expo-secure-store`:
 * entrambe tolgono il segreto dal pacchetto, che e' l'unica soluzione vera.
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
 * Si accetta anche una stringa separata da virgole: `app.json` regge entrambe
 * le forme, e chi incolla da un `.env` produce naturalmente la seconda.
 */
export function apiKeys(): string[] {
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
  return extra().groqModelComplex ?? 'llama-3.3-70b-versatile';
}

export function modelFast(): string {
  return extra().groqModelFast ?? 'llama-3.1-8b-instant';
}

/** `false` quando non c'e' nemmeno una chiave: la UI puo' nascondere l'agente. */
export function isConfigured(): boolean {
  return apiKeys().length > 0;
}
