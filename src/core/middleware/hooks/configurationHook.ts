import {
  createConfiguration,
  deleteConfiguration,
  getAllConfigurations,
  setActiveConfiguration,
  updateConfiguration,
} from '@/core/repositories/configurationsRepository';
import {
  validateConfigurationDraft,
  type Configuration,
  type ConfigurationDraft,
} from '@/domain/configuration';
import { useConfigurationsStore } from '@/state/useConfigurationsStore';
import { useWatchlistStore } from '@/state/useWatchlistStore';

/**
 * Gestione delle configurazioni d'asta.
 *
 * Come `categoryHook`, e per la stessa ragione, NON usa `createPipeline`:
 * la creazione ha bisogno dell'id AUTOINCREMENT prima di poter aggiornare lo
 * stato in memoria, e il pattern "reduce sincrono + effect differito"
 * presuppone che lo stato locale sia calcolabile senza il DB. Queste operazioni
 * sono rare, deliberate e fuori dal percorso caldo dello scroll: restare
 * asincroni e attesi dalla UI non viola l'invariante "mai I/O nel frame".
 */

export interface ConfigurationMutationResult {
  ok: boolean;
  reason?: string;
}

async function resync(): Promise<Configuration[]> {
  const configurations = await getAllConfigurations();
  useConfigurationsStore.getState().setLocal(configurations);
  return configurations;
}

/**
 * Riallinea la watchlist in memoria alla configurazione attiva.
 * Va invocata dopo ogni mutazione che possa cambiare *quale* configurazione e'
 * attiva: la mappa delle assegnazioni appartiene a una lega sola.
 */
async function syncWatchlist(): Promise<void> {
  const { activeId } = useConfigurationsStore.getState();
  const watchlist = useWatchlistStore.getState();
  if (watchlist.configId === activeId) return;
  await watchlist.load(activeId);
}

export async function addConfiguration(
  draft: ConfigurationDraft
): Promise<ConfigurationMutationResult> {
  const existing = useConfigurationsStore.getState().configurations;
  const verdict = validateConfigurationDraft(draft, existing);
  if (verdict !== true) return { ok: false, reason: verdict };

  await createConfiguration(draft);
  await resync();
  // La prima configurazione nasce attiva (vedi repository): la watchlist deve
  // saperlo, altrimenti resterebbe agganciata a `null` e ogni assegnazione
  // verrebbe rifiutata in validazione.
  await syncWatchlist();
  return { ok: true };
}

export async function editConfiguration(
  id: number,
  draft: ConfigurationDraft
): Promise<ConfigurationMutationResult> {
  const existing = useConfigurationsStore.getState().configurations;
  const verdict = validateConfigurationDraft(draft, existing, id);
  if (verdict !== true) return { ok: false, reason: verdict };

  await updateConfiguration(id, draft);
  await resync();
  return { ok: true };
}

/**
 * Eliminazione distruttiva: il CASCADE porta via la watchlist di quella
 * configurazione. La conferma e' responsabilita' della schermata chiamante.
 *
 * Se spariva la configurazione attiva si promuove la prima rimasta, cosi'
 * l'utente non resta in uno stato in cui il listone non accetta assegnazioni.
 * Se non ne resta nessuna, `activeId` diventa `null` e il gate di primo avvio
 * rimette in scena il wizard.
 */
export async function removeConfiguration(
  id: number
): Promise<ConfigurationMutationResult> {
  const { configurations, activeId } = useConfigurationsStore.getState();
  if (!configurations.some((c) => c.id === id)) {
    return { ok: false, reason: 'Configurazione inesistente.' };
  }

  await deleteConfiguration(id);

  if (activeId === id) {
    const heir = configurations.find((c) => c.id !== id);
    if (heir) await setActiveConfiguration(heir.id);
  }

  await resync();
  await syncWatchlist();
  return { ok: true };
}

export async function activateConfiguration(
  id: number
): Promise<ConfigurationMutationResult> {
  const { byId, activeId } = useConfigurationsStore.getState();
  if (!byId[id]) return { ok: false, reason: 'Configurazione inesistente.' };
  if (activeId === id) return { ok: true };

  await setActiveConfiguration(id);
  await resync();
  await syncWatchlist();
  return { ok: true };
}
