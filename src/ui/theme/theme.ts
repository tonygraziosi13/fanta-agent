/**
 * Design token dell'app.
 *
 * Tema scuro fisso: l'asta si gioca la sera, spesso al buio, e la codifica
 * cromatica dei ruoli (US1-T2) e' calibrata per stagliarsi su fondo scuro.
 * Un tema chiaro richiederebbe di ritarare quei colori e non e' nelle US.
 */

export const colors = {
  background: '#0B1220',
  surface: '#121C2E',
  surfaceRaised: '#1A2740',
  border: '#243354',

  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',

  accent: '#38BDF8',
  danger: '#EF4444',
  overlay: 'rgba(3, 7, 18, 0.7)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  /**
   * Il numero principale della scheda (il FVM). E' grande di proposito: la
   * schermata si legge durante un'asta, a distanza di braccio, mentre qualcuno
   * sta rilanciando. Il salto da 46 a 10.5 non e' esuberanza tipografica — e'
   * l'unico modo di costruire una gerarchia netta senza un caratttere
   * display, che qui significherebbe aggiungere `expo-font` e il caricamento
   * asincrono dei glifi.
   */
  display: { fontSize: 46, fontWeight: '800' },
  figure: { fontSize: 28, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 15, fontWeight: '400' },
  bodyBold: { fontSize: 15, fontWeight: '700' },
  caption: { fontSize: 12, fontWeight: '500' },
  /** Etichetta in maiuscoletto spaziato: sopra i numeri, mai in mezzo al testo. */
  overline: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8 },
} as const;

/**
 * Ombre appena percettibili.
 *
 * Su fondo scuro un'ombra nera non si vede: quel che separa una card dallo
 * sfondo e' il bordo chiaro piu' un alone ancora piu' scuro del fondo. iOS e
 * Android le esprimono con proprieta' diverse e incompatibili, quindi vivono
 * qui una volta sola invece di essere riscritte in ogni componente.
 */
export const elevation = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  hero: {
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

/**
 * Colore esadecimale + trasparenza, come stringa `#RRGGBBAA`.
 *
 * Serve a tingere una superficie del colore del ruolo senza definire una
 * seconda tavolozza: il colore resta quello di `domain/roles.ts`, qui se ne
 * regola solo l'intensita'. React Native accetta il formato a 8 cifre su
 * entrambe le piattaforme.
 */
export function withAlpha(color: string, alpha: number): string {
  const clamped = Math.min(Math.max(alpha, 0), 1);
  const hex = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
  return `${color}${hex}`;
}

/**
 * Altezza fissa della riga del listone.
 * FlashList usa questa costante per stimare il layout senza misurare ogni
 * elemento: e' cio' che tiene lo scroll dei 497 record a 60fps (US1-T3).
 */
export const PLAYER_ROW_HEIGHT = 64;
