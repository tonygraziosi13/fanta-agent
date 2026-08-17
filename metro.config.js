// Metro non conosce l'estensione .csv: senza questa riga `require('.../listone.csv')`
// fallisce in bundling e l'asset del listone (US7) non viene mai imbarcato nell'app.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...config.resolver.assetExts, 'csv'];

module.exports = config;
