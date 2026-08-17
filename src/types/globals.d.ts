/**
 * `__DEV__` e' iniettata dal bundler Metro, non da un modulo importabile.
 * React Native ne fornisce i tipi, ma dichiararla qui rende il progetto
 * type-safe anche eseguendo `tsc` fuori dal contesto RN (es. in CI).
 */
declare const __DEV__: boolean;
