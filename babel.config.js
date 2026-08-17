// L'alias `@/*` NON e' configurato qui: da Expo SDK 50 babel-preset-expo legge
// direttamente `paths` da tsconfig.json (tsconfigPaths e' attivo di default).
// Aggiungere babel-plugin-module-resolver duplicherebbe la risoluzione.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
