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
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 15, fontWeight: '400' },
  bodyBold: { fontSize: 15, fontWeight: '700' },
  caption: { fontSize: 12, fontWeight: '500' },
} as const;

/**
 * Altezza fissa della riga del listone.
 * FlashList usa questa costante per stimare il layout senza misurare ogni
 * elemento: e' cio' che tiene lo scroll dei 497 record a 60fps (US1-T3).
 */
export const PLAYER_ROW_HEIGHT = 64;
