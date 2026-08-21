import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Alternativa, BudgetVerdict } from '@/domain/budgetAlert';
import { ROLE_COLORS } from '@/domain/roles';
import { colors, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Avviso economico sulla watchlist.
 *
 * --- Quando compare, e quando no ---
 * Solo quando c'e' un deficit reale. Un avviso permanente che dice "attento ai
 * crediti" e' una spia sempre accesa: dopo dieci minuti non la guarda piu'
 * nessuno, e quando serve davvero non viene notata.
 *
 * --- Perche' dice anche il *perche'* ---
 * "Ti mancano 120 crediti" senza il conto e' un numero da prendere per buono in
 * un momento in cui non si ha tempo di verificarlo. La riga sotto mostra il
 * fabbisogno per reparto e su che stima e' costruito — inflazione misurata al
 * tavolo o quotazione nuda — cosi' chi vuole controllare puo', e chi non vuole
 * non e' costretto.
 */

interface Props {
  verdict: BudgetVerdict;
  alternative: Alternativa[];
  /** Apre il dettaglio di un sostituto proposto. */
  onPressPlayer?: (playerId: number) => void;
}

export function BudgetAlert({ verdict, alternative, onPressPlayer }: Props) {
  const [aperto, setAperto] = useState(false);

  // Niente deficit, niente avviso: vedi il commento sopra.
  if (verdict.deficit <= 0) return null;

  const stima =
    verdict.inflazione === null
      ? 'stimato sulle quotazioni'
      : `stimato sui prezzi di questa asta (+${Math.round((verdict.inflazione - 1) * 100)}%)`;

  return (
    <View style={styles.contenitore}>
      <TouchableOpacity
        onPress={() => setAperto((v) => !v)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityState={{ expanded: aperto }}
        accessibilityLabel={`Ti mancano ${verdict.deficit} crediti per i tuoi obiettivi. Tocca per il dettaglio.`}
      >
        <View style={styles.testa}>
          <Text style={styles.titolo}>Budget corto</Text>
          <Text style={styles.chevron}>{aperto ? '▾' : '▸'}</Text>
        </View>

        <Text style={styles.frase}>
          Per riempire le caselle che ti restano coi giocatori in lista servirebbero{' '}
          <Text style={styles.numero}>{verdict.fabbisogno}</Text> crediti, ne hai{' '}
          <Text style={styles.numero}>{verdict.disponibile}</Text>.
        </Text>
        <Text style={styles.stima}>{stima}</Text>
      </TouchableOpacity>

      {aperto && (
        <View style={styles.dettaglio}>
          <View style={styles.reparti}>
            {verdict.perRuolo
              .filter((r) => r.slotLiberi > 0)
              .map((r) => (
                <View key={r.ruolo} style={styles.reparto}>
                  <View style={[styles.pallino, { backgroundColor: ROLE_COLORS[r.ruolo] }]} />
                  <Text style={styles.repartoTesto}>
                    {r.ruolo} {r.slotLiberi} · {r.costo} cr
                    {r.scoperto ? ` · solo ${r.disponibili} in lista` : ''}
                  </Text>
                </View>
              ))}
          </View>

          {alternative.length > 0 && (
            <View style={styles.alternative}>
              <Text style={styles.alternativeTitolo}>Fuori portata, e chi resta</Text>
              {alternative.map(({ target, sostituti }) => (
                <View key={target.id} style={styles.riga}>
                  <Text style={styles.target} numberOfLines={1}>
                    {target.nome}
                  </Text>
                  {sostituti.length === 0 ? (
                    <Text style={styles.nessunSostituto}>
                      Niente di paragonabile in quella fascia.
                    </Text>
                  ) : (
                    <Text style={styles.sostituti}>
                      {sostituti.map((s, i) => (
                        <Text key={s.id}>
                          {i > 0 ? ' · ' : ''}
                          <Text
                            onPress={onPressPlayer ? () => onPressPlayer(s.id) : undefined}
                            style={onPressPlayer ? styles.sostituoLink : undefined}
                          >
                            {s.nome}
                          </Text>
                          <Text style={styles.prezzo}> {s.qt_a}</Text>
                        </Text>
                      ))}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  contenitore: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha('#F5C518', 0.5),
    backgroundColor: withAlpha('#F5C518', 0.1),
    gap: spacing.xs,
  },
  testa: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titolo: {
    color: '#F5C518',
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
  },
  chevron: { color: colors.textMuted, fontSize: 14 },
  frase: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    lineHeight: 18,
  },
  numero: {
    color: colors.textPrimary,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  stima: { color: colors.textMuted, fontSize: 11 },

  dettaglio: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(colors.border, 0.9),
    gap: spacing.md,
  },
  reparti: { gap: spacing.xs },
  reparto: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pallino: { width: 6, height: 6, borderRadius: radius.pill },
  repartoTesto: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontVariant: ['tabular-nums'],
  },

  alternative: { gap: spacing.sm },
  alternativeTitolo: {
    color: colors.textMuted,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
  },
  riga: { gap: 2 },
  target: {
    color: colors.textPrimary,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
  },
  sostituti: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    lineHeight: 18,
  },
  sostituoLink: { color: colors.accent, fontWeight: '700' },
  prezzo: { color: colors.textMuted, fontVariant: ['tabular-nums'] },
  nessunSostituto: {
    color: colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
  },
});
