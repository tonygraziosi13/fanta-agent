import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Player } from '@/domain/player';
import { ROLE_COLORS, ROLE_LABELS, parseMantraRoles } from '@/domain/roles';
import { colors, elevation, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Testata della scheda: chi e', e quanto vale.
 *
 * --- La scelta che governa questo blocco ---
 * Il FVM e' composto piu' grande del nome. Sembra un'inversione della gerarchia
 * naturale, ed e' deliberata: nel momento in cui questa schermata viene aperta
 * — un'asta, qualcuno ha appena gridato un nome e il banditore sta contando —
 * l'identita' del giocatore e' l'unica cosa che l'utente gia' conosce. Quello
 * che non sa, e che deve leggere a distanza di braccio in un paio di secondi,
 * e' quanto quel giocatore valga.
 *
 * --- La tinta di ruolo ---
 * Lo sfondo prende il colore del ruolo (`domain/roles.ts`, dove P=giallo,
 * D=verde, C=blu, A=rosso e' un criterio di accettazione). Non e' decorazione:
 * e' l'unico colore della schermata che dice *chi* si sta guardando, e rende
 * ogni scheda riconoscibile prima di aver letto una parola. I colori semantici
 * — verdetto, rischio, fantamedia — restano separati e non lo incrociano mai,
 * perche' dicono un'altra cosa: quanto e' buono, non chi e'.
 *
 * L'alone e' costruito con due `View` sovrapposte a bassa opacita' invece che
 * con un gradiente: `expo-linear-gradient` sarebbe una dipendenza nativa in
 * piu' per un effetto che due rettangoli traslucidi rendono altrettanto bene.
 */

interface Props {
  player: Player;
  /** Valore gia' formattato: il dominio decide come si scrive un numero. */
  fvm: string;
  quotazione: string;
  variazione: string;
  /** Segno della variazione: decide il colore, non il testo. */
  trend: 'su' | 'giu' | 'fermo';
  categoryName: string | null;
  categoryColor: string | null;
  onPressCategory: () => void;
}

export function PlayerHero({
  player,
  fvm,
  quotazione,
  variazione,
  trend,
  categoryName,
  categoryColor,
  onPressCategory,
}: Props) {
  const role = ROLE_COLORS[player.r];
  const mantra = parseMantraRoles(player.rm);
  const trendColor =
    trend === 'su' ? '#22C55E' : trend === 'giu' ? colors.danger : colors.textMuted;

  return (
    <View style={[styles.card, { borderColor: withAlpha(role, 0.35) }, elevation.hero]}>
      {/* L'alone di ruolo: due strati traslucidi, nessuna dipendenza grafica. */}
      <View pointerEvents="none" style={[styles.wash, { backgroundColor: withAlpha(role, 0.1) }]} />
      <View pointerEvents="none" style={[styles.glow, { backgroundColor: withAlpha(role, 0.14) }]} />

      <View style={styles.identity}>
        <View style={[styles.roleChip, { backgroundColor: role }]}>
          <Text style={styles.roleChipText}>{player.r}</Text>
        </View>
        <View style={styles.identityText}>
          <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {player.nome}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {player.squadra} · {ROLE_LABELS[player.r]}
            {mantra.length > 0 ? ` · ${mantra.join('/')}` : ''}
          </Text>
        </View>
      </View>

      {!player.is_active && (
        <View style={styles.soldRow}>
          <View style={styles.soldDot} />
          <Text style={styles.soldText}>Non più in Serie A</Text>
        </View>
      )}

      <View style={styles.priceRow}>
        <View style={styles.priceMain}>
          <Text style={styles.priceLabel}>FantaValore di mercato</Text>
          <Text style={styles.price} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {fvm}
          </Text>
        </View>

        <View style={styles.priceAside}>
          <Text style={styles.asideLabel}>Quotazione</Text>
          <Text style={styles.asideValue}>{quotazione}</Text>
          <Text style={[styles.asideDelta, { color: trendColor }]}>{variazione}</Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={onPressCategory}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={
          categoryName
            ? `In watchlist, categoria ${categoryName}. Tocca per cambiare.`
            : 'Aggiungi alla watchlist'
        }
        style={[
          styles.assign,
          categoryName && categoryColor
            ? { backgroundColor: categoryColor, borderColor: categoryColor }
            : { borderColor: withAlpha(role, 0.5) },
        ]}
      >
        <Text
          style={[styles.assignText, categoryName ? styles.assignTextOn : { color: role }]}
          numberOfLines={1}
        >
          {categoryName ?? '+  Aggiungi alla watchlist'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
  },
  wash: {
    ...StyleSheet.absoluteFillObject,
  },
  glow: {
    position: 'absolute',
    top: -110,
    right: -70,
    width: 240,
    height: 240,
    borderRadius: 120,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  roleChip: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleChipText: {
    color: '#0B1220',
    fontSize: typography.heading.fontSize,
    fontWeight: '800',
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: colors.textPrimary,
    fontSize: typography.title.fontSize,
    fontWeight: '700',
  },
  meta: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
  },
  soldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  soldDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
  },
  soldText: {
    color: colors.danger,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.lg,
  },
  priceMain: {
    flex: 1,
    minWidth: 0,
  },
  priceLabel: {
    color: colors.textSecondary,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
  },
  price: {
    color: colors.textPrimary,
    fontSize: typography.display.fontSize,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    // Il default di RN lascia troppo spazio sopra un numero cosi' grande.
    lineHeight: typography.display.fontSize * 1.05,
    marginTop: 2,
  },
  priceAside: {
    alignItems: 'flex-end',
    paddingBottom: spacing.xs,
  },
  asideLabel: {
    color: colors.textMuted,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
  },
  asideValue: {
    color: colors.textPrimary,
    fontSize: typography.heading.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  asideDelta: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  assign: {
    borderWidth: 1,
    borderRadius: radius.pill,
    // 44pt e' la soglia sotto la quale un bersaglio tattile diventa difficile
    // da centrare — e questo si preme con il telefono in una mano, di sera,
    // mentre si sta ascoltando un rilancio.
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  assignText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  assignTextOn: {
    color: '#0B1220',
  },
});
