#!/usr/bin/env node
/**
 * Crea `scripts/dataset/stato_asta.json` vuoto se non esiste.
 *
 * Serve a una cosa sola, ed e' un vincolo del bundler: Metro risolve gli import
 * a build time, quindi `statoAstaSeed.ts` non puo' importare un file che
 * potrebbe non esserci — un file mancante non e' `null` a runtime, e' un errore
 * di bundling che blocca `expo start`.
 *
 * Quel file e' gitignorato di proposito (contiene i nomi dei partecipanti della
 * lega, e Pages servirebbe la radice di `main`), quindi su un clone fresco non
 * c'e'. Questo script lo crea come array vuoto: il bundler lo trova, il modulo
 * lo legge come "nessun seme", e chi ha le credenziali lo riempie con
 * `npm run asta`.
 *
 * Non sovrascrive mai un file esistente: girando da `postinstall`, azzerare uno
 * stato d'asta in corso perche' qualcuno ha reinstallato le dipendenze sarebbe
 * un danno silenzioso e difficile da ricostruire.
 */

const fs = require('fs');
const path = require('path');

const SEED = path.join(__dirname, 'dataset', 'stato_asta.json');

if (fs.existsSync(SEED)) {
  process.exit(0);
}

fs.mkdirSync(path.dirname(SEED), { recursive: true });
fs.writeFileSync(SEED, '[]\n', 'utf-8');
console.log(`[ensure_seed] creato ${path.relative(process.cwd(), SEED)} vuoto`);
