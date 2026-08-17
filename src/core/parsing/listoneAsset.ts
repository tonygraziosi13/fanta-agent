import { Asset } from 'expo-asset';
import { parseCsvText, type CsvRecord } from './csvParser';

/**
 * Lettura del listone dagli assets dell'app (US7-T2).
 * Unico modulo del layer di parsing con dipendenze native.
 */

/**
 * Doppia strategia deliberata: expo-file-system ha cambiato API in SDK 54
 * (nuova classe `File`; la vecchia `readAsStringAsync` e' passata sotto
 * /legacy). Si tenta la nuova e si ricade sulla legacy, cosi' il bootstrap non
 * dipende dalla minor version di expo-file-system effettivamente installata.
 */
async function readAssetText(moduleRef: number): Promise<string> {
  const asset = Asset.fromModule(moduleRef);
  await asset.downloadAsync();

  const uri = asset.localUri ?? asset.uri;
  if (!uri) {
    throw new Error('[listoneAsset] Asset del listone privo di URI locale.');
  }

  try {
    const fs = await import('expo-file-system');
    if (typeof fs.File === 'function') {
      return new fs.File(uri).text();
    }
  } catch {
    // API nuova non disponibile: si prosegue con la legacy.
  }

  const legacy = await import('expo-file-system/legacy');
  return legacy.readAsStringAsync(uri);
}

export async function loadListoneCsv(): Promise<CsvRecord[]> {
  // require statico: Metro deve poter risolvere l'asset a build time
  // (vedi metro.config.js, che registra l'estensione .csv).
  const text = await readAssetText(require('../../../assets/data/listone.csv'));
  return parseCsvText(text);
}
