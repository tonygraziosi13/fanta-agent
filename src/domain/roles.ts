/**
 * Ruoli Classic e Mantra + la mappatura cromatica.
 *
 * US1-T2 impone la codifica colore in modo tassativo:
 *   Portiere = Giallo, Difensore = Verde, Centrocampista = Blu, Attaccante = Rosso.
 * Vive qui e non nel theme perche' e' semantica di dominio, non scelta estetica:
 * cambiarla romperebbe un criterio di accettazione.
 */

export const CLASSIC_ROLES = ['P', 'D', 'C', 'A'] as const;
export type ClassicRole = (typeof CLASSIC_ROLES)[number];

export const ROLE_FILTER_ALL = 'ALL' as const;
export type RoleFilter = ClassicRole | typeof ROLE_FILTER_ALL;

export const ROLE_COLORS: Record<ClassicRole, string> = {
  P: '#F5C518', // Giallo
  D: '#22C55E', // Verde
  C: '#3B82F6', // Blu
  A: '#EF4444', // Rosso
};

/** Testo leggibile sopra il colore del ruolo (il giallo richiede testo scuro). */
export const ROLE_TEXT_COLORS: Record<ClassicRole, string> = {
  P: '#1A1400',
  D: '#04220F',
  C: '#FFFFFF',
  A: '#FFFFFF',
};

export const ROLE_LABELS: Record<ClassicRole, string> = {
  P: 'Portieri',
  D: 'Difensori',
  C: 'Centrocampisti',
  A: 'Attaccanti',
};

export function isClassicRole(value: string): value is ClassicRole {
  return (CLASSIC_ROLES as readonly string[]).includes(value);
}

/**
 * I ruoli Mantra arrivano come stringa multi-valore separata da ';'
 * (es. "Ds;Dc", "M;C", "B;Dd;E"). Il DB conserva la stringa grezza —
 * fedelta' al tracciato ufficiale — e la normalizzazione avviene qui,
 * dove serve alla UI.
 */
export function parseMantraRoles(rm: string | null | undefined): string[] {
  if (!rm) return [];
  return rm
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean);
}
