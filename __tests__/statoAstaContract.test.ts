import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { countMine, parseStatoAsta } from '@/core/parsing/statoAstaParser';

/**
 * Contratto fra lo scraper Python e il parser dell'app, sul file vero.
 *
 * Sono due linguaggi e due processi distinti: `scripts/dataset/asta.py` scrive,
 * `statoAstaParser.ts` legge, e nessun altro test impedirebbe a un campo
 * rinominato da un lato di passare inosservato fino all'import sul telefono.
 *
 * Il file e' gitignorato e generato solo da chi ha le credenziali: senza, la
 * suite si salta invece di fallire — un clone fresco non ha una lega da leggere.
 * Stessa scelta di `datasetContract.test.ts`.
 */

const SEED = join(__dirname, '..', 'scripts', 'dataset', 'stato_asta.json');
const generato = existsSync(SEED);
const describeSeGenerato = generato ? describe : describe.skip;

describeSeGenerato('contratto stato_asta (file reale)', () => {
  const raw = generato ? readFileSync(SEED, 'utf-8') : '[]';

  it('il file generato passa il parser dell’app', () => {
    const outcome = parseStatoAsta(raw);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.teams.length).toBeGreaterThan(1);
  });

  it('nessuna riga viene scartata', () => {
    /**
     * Se lo scraper cambia forma, questo è il posto in cui si vede: `skipped`
     * non vuoto significa che i due lati hanno smesso di parlare la stessa lingua.
     */
    const outcome = parseStatoAsta(raw);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.skipped).toEqual([]);
  });

  it('esattamente una squadra è marcata come propria', () => {
    /**
     * Zero: l'agente non sa quali crediti sono dell'utente. Due: ogni
     * ragionamento sui *propri* crediti diventa ambiguo.
     */
    const outcome = parseStatoAsta(raw);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(countMine(outcome.value.teams)).toBe(1);
  });
});
