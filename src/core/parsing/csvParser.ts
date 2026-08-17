import Papa from 'papaparse';

/**
 * Parsing CSV puro (US7-T2).
 *
 * Deliberatamente privo di import Expo/React Native: e' logica testabile in
 * Jest senza montare l'ambiente nativo. La lettura dell'asset — che ha
 * dipendenze native — vive in listoneAsset.ts.
 *
 * Perche' PapaParse e non `text.split(',')`:
 * il listone di oggi non contiene virgole nei nomi, ma viene rigenerato a ogni
 * sessione di mercato dal file ufficiale. Uno split ingenuo si romperebbe in
 * silenzio il giorno in cui comparisse un "Rossi, Jr.", corrompendo il DB senza
 * alcun errore visibile.
 */

export type CsvRecord = Record<string, string>;

export function parseCsvText(text: string): CsvRecord[] {
  const result = Papa.parse<CsvRecord>(text, {
    header: true, // US7-T2: l'header non finisce fra i dati
    skipEmptyLines: true,
    transform: (value) => value.trim(),
    transformHeader: (header) => header.trim(),
  });

  // Papa accumula gli errori per riga senza sollevare: alzare la voce qui e'
  // meglio che scoprire a valle un DB con 3 record invece di 505.
  if (result.errors.length > 0) {
    const preview = result.errors
      .slice(0, 3)
      .map((e) => `riga ${e.row}: ${e.message}`)
      .join(' | ');
    throw new Error(`[csvParser] CSV malformato (${result.errors.length} errori). ${preview}`);
  }

  return result.data;
}
