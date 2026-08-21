import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Tessera numerica: un valore grande, un'etichetta piccola sotto.
 *
 * E' il formato dello strato "a colpo d'occhio": quattro numeri affiancati che
 * si leggono senza mettere a fuoco. Le righe con barra (`StatBar`) restano per
 * lo strato di approfondimento, dove il confronto conta piu' della velocita'.
 *
 * --- Il dato assente non fa collassare la griglia ---
 * Una tessera senza dato mantiene esattamente l'ingombro di una piena: stesso
 * `minHeight`, stesso posto nella riga, solo il numero diventa un trattino
 * tenue. Nascondere le tessere vuote farebbe ballare la griglia da un
 * giocatore all'altro, e — peggio — farebbe sembrare piu' completa la scheda di
 * chi ha meno dati.
 *
 * Il trattino non e' uno zero, ed e' la regola che attraversa tutta l'app: un
 * attaccante arrivato ora in Serie A non ha "0 xG", non ha xG.
 */

interface Props {
  label: string;
  /** Gia' formattato dal dominio; '—' significa "non disponibile". */
  value: string;
  /**
   * Colore del numero, per i valori che portano un giudizio (la fantamedia).
   * Ignorato quando il dato manca: un trattino colorato di verde direbbe che
   * l'assenza e' una buona notizia.
   */
  tone?: string;
}

function StatTileComponent({ label, value, tone }: Props) {
  const missing = value === '—';

  return (
    <View
      style={styles.tile}
      accessibilityRole="text"
      accessibilityLabel={missing ? `${label}: dato non disponibile` : `${label}: ${value}`}
    >
      <Text
        style={[styles.value, missing ? styles.valueMissing : undefined, tone && !missing ? { color: tone } : undefined]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 0,
    minHeight: 74,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    // Orizzontale stretto di proposito: su uno schermo da 320pt quattro
    // tessere lasciano ~68pt ciascuna, e "Fantamedia" in maiuscoletto
    // spaziato ci sta solo se il padding non se ne mangia otto.
    paddingHorizontal: 2,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.surfaceRaised, 0.55),
  },
  value: {
    color: colors.textPrimary,
    fontSize: typography.figure.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  valueMissing: {
    color: colors.textMuted,
    fontWeight: '400',
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
  },
});

export const StatTile = memo(StatTileComponent);
