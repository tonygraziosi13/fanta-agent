/**
 * Il giro delle chiavi API.
 *
 * Sul piano gratuito di Groq il rate limit si esaurisce in fretta, e cinque
 * chiavi servono a non fermarsi. Perche' funzioni davvero contano tre dettagli
 * che sembrano minori e non lo sono.
 *
 * **Lo stato sopravvive alla singola chiamata.** Se ogni richiesta ripartisse
 * dalla prima chiave, quella esaurita verrebbe ricolpita ogni volta: si
 * pagherebbe un 429 per richiesta prima di arrivare a una chiave viva, e il
 * vantaggio di averne cinque sparirebbe.
 *
 * **Una chiave revocata esce dal giro.** Un 401 non si risolve ritentando, e
 * lasciarla in rotazione la farebbe riprovare a ogni ciclo — un rate limit
 * permanente travestito da problema di quota.
 *
 * **Il giro e' finito.** Con tutte le chiavi esaurite si deve fallire, non
 * girare all'infinito su un'app che l'utente ha in mano mentre il banditore
 * conta.
 */

export class KeyRing {
  private readonly keys: string[];
  private index = 0;
  /** Chiavi rifiutate in modo definitivo (401/403): fuori dal giro. */
  private readonly revocate = new Set<string>();

  constructor(keys: ReadonlyArray<string>) {
    // Si normalizzano qui e non a ogni uso: una chiave con uno spazio in coda,
    // copiata male dalla console, produrrebbe un 401 indistinguibile da una
    // revoca vera.
    this.keys = keys.map((k) => k.trim()).filter((k) => k.length > 0);
  }

  get size(): number {
    return this.keys.length;
  }

  /** Quante chiavi sono ancora utilizzabili. */
  get disponibili(): number {
    return this.keys.filter((k) => !this.revocate.has(k)).length;
  }

  /** La chiave attiva, o `null` se non ne restano. */
  current(): string | null {
    if (this.disponibili === 0) return null;

    // Si avanza fino alla prima non revocata: il `for` limitato alla lunghezza
    // garantisce che il giro finisca anche se l'indice parte da una revocata.
    for (let i = 0; i < this.keys.length; i += 1) {
      const key = this.keys[(this.index + i) % this.keys.length]!;
      if (!this.revocate.has(key)) {
        this.index = (this.index + i) % this.keys.length;
        return key;
      }
    }
    return null;
  }

  /** Passa alla successiva utilizzabile. Restituisce `null` se non ce ne sono. */
  advance(): string | null {
    if (this.disponibili === 0) return null;
    this.index = (this.index + 1) % this.keys.length;
    return this.current();
  }

  /** Toglie definitivamente una chiave dal giro (401/403). */
  revoke(key: string): void {
    this.revocate.add(key);
  }

  /** Per i test e la diagnostica: quali chiavi sono state scartate. */
  get revocateCount(): number {
    return this.revocate.size;
  }
}
