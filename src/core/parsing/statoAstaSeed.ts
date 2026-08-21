/**
 * Il seme dello stato d'asta, imbarcato nel bundle di sviluppo.
 *
 * --- Perche' esiste ---
 * `scripts/dataset/stato_asta.json` e' gitignorato: non puo' viaggiare col sync
 * (passerebbe da GitHub Pages) ne' essere committato come asset. Senza un
 * canale, l'unico modo di provare l'import sul telefono sarebbe incollare due
 * chilobyte di JSON in una console di debug a ogni tentativo.
 *
 * Metro pero' impacchetta i `.json` importati staticamente. Il file finisce
 * quindi nel bundle **costruito su questa macchina**, cioe' su questo telefono,
 * senza passare da git e senza diventare pubblico.
 *
 * --- Perche' solo in sviluppo ---
 * In una build di produzione sarebbe un dato personale incollato dentro
 * l'applicazione, e per giunta gia' vecchio. Il seme serve a collaudare la
 * catena; l'import vero passera' da un'interfaccia.
 *
 * --- La guardia sul clone pulito ---
 * Metro risolve gli import a build time: un file mancante non e' un `null` a
 * runtime, e' un errore di bundling. Su un clone fresco quel file non esiste
 * perche' e' gitignorato, quindi `npm install` lo crea vuoto (`postinstall` ->
 * `scripts/ensure_seed.js`). Il risultato e' un array vuoto, che questo modulo
 * tratta come "nessun seme" — che e' esattamente la verita'.
 */

import seed from '../../../scripts/dataset/stato_asta.json';

/** Il contenuto grezzo del seme, o `null` se non ce n'e' uno utilizzabile. */
export function readDevSeed(): string | null {
  if (!__DEV__) return null;
  if (!Array.isArray(seed) || seed.length === 0) return null;
  // Si restituisce testo e non l'oggetto: `parseStatoAsta` accetta il grezzo
  // proprio per poter distinguere "JSON invalido" da "forma sbagliata", e far
  // passare il seme dalla stessa porta dell'import manuale significa che le due
  // strade non possono divergere.
  return JSON.stringify(seed);
}
