import { indexByTeam, parseCoaches, teamKey } from './coachesParser';
import type { Team } from '@/domain/team';

/**
 * Il profilo tattico delle squadre, imbarcato nel bundle.
 *
 * --- Perche' un asset e non il sync ---
 * Sono venti righe che cambiano una volta a settimana, e il motore di sync
 * scarica `manifest.json → players.json` e nient'altro. Estenderlo a un secondo
 * payload significherebbe toccare il contratto, aggiungere una tabella e una
 * migrazione: infrastruttura per dati che stanno in trenta chilobyte e arrivano
 * gratis col bundle.
 *
 * Il prezzo, dichiarato: **si aggiornano solo ricompilando**. Se un giorno
 * servisse freschezza fra due build, la strada e' il secondo payload.
 *
 * --- Perche' questo file esiste separato dal parser ---
 * Stessa divisione di `listoneAsset.ts` / `csvParser.ts`: qui c'e' l'unico
 * `import` che il bundler deve risolvere, li' c'e' la logica testabile in Jest
 * senza ambiente nativo. Un parser che importa un asset non si testa.
 */

import raw from '../../../dataset/coaches.json';

let cache: { teams: Team[]; byName: Record<string, Team> } | null = null;

/**
 * Le squadre, lette una volta sola.
 *
 * Il parsing di venti righe costa poco, ma questa funzione viene chiamata da
 * ogni valutazione dell'Indice Modificatore — cioe' potenzialmente a ogni tocco
 * durante un'asta. Rifarlo ogni volta sarebbe lavoro gettato.
 */
export function loadTeams(): { teams: Team[]; byName: Record<string, Team> } {
  if (cache !== null) return cache;

  const outcome = parseCoaches(raw);
  if (!outcome.ok) {
    // Non si solleva: senza profili tattici l'Indice Modificatore perde una
    // componente e si rinormalizza, ma il resto dell'app funziona. Un file
    // malformato non deve impedire di aprire il listone.
    if (__DEV__) {
      console.warn(`[coaches] ${outcome.error}`);
    }
    cache = { teams: [], byName: {} };
    return cache;
  }

  if (__DEV__ && outcome.value.skipped.length > 0) {
    console.warn('[coaches] squadre scartate:', outcome.value.skipped);
  }

  cache = { teams: outcome.value.teams, byName: indexByTeam(outcome.value.teams) };
  return cache;
}

/** Il profilo della squadra di un giocatore, o `undefined` se non lo conosciamo. */
export function findTeam(squadra: string): Team | undefined {
  return loadTeams().byName[teamKey(squadra)];
}
