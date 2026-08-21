import { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { offertaMassima, slotRimanenti, type Opponent } from '@/domain/opponent';
import { CLASSIC_ROLES } from '@/domain/roles';
import { colors, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';
import { SlotGrid } from './SlotGrid';

/**
 * Una squadra al tavolo.
 *
 * Tre informazioni e non una di piu': quanto le resta, quanto puo' offrire su
 * un singolo giocatore, e quali caselle deve ancora riempire. Il resto —
 * proprietario, storico, media — appartiene a un'altra schermata: qui ogni
 * riga viene letta di sfuggita fra un rilancio e l'altro.
 *
 * I crediti e l'offerta massima stanno affiancati perche' la differenza fra i
 * due *e'* l'informazione: 300 crediti con venti slot vuoti non sono 300
 * crediti spendibili, e vedere i due numeri accanto lo spiega senza una parola.
 */

interface Props {
  opponent: Opponent;
  /** Slot totali della configurazione: servono a disegnare le caselle vuote. */
  totali: Record<(typeof CLASSIC_ROLES)[number], number>;
  onPress?: () => void;
}

function TeamRowComponent({ opponent, totali, onPress }: Props) {
  const massimo = offertaMassima(opponent);
  const rimasti = slotRimanenti(opponent);
  const completa = rimasti === 0;

  const contenuto = (
    <View style={[styles.riga, opponent.isMe && styles.rigaMia]}>
      <View style={styles.intestazione}>
        <Text style={[styles.nome, opponent.isMe && styles.nomeMio]} numberOfLines={1}>
          {opponent.nome}
        </Text>
        {opponent.isMe && <Text style={styles.tu}>tu</Text>}
        {completa && <Text style={styles.completa}>rosa completa</Text>}
      </View>

      <SlotGrid liberi={opponent.slotLiberi} totali={totali} size="compact" />

      <View style={styles.numeri}>
        <View style={styles.numero}>
          <Text style={styles.valore}>{opponent.creditiResidui}</Text>
          <Text style={styles.etichetta}>crediti</Text>
        </View>
        <View style={styles.numero}>
          <Text style={[styles.valore, styles.valoreSecondario]}>{massimo}</Text>
          <Text style={styles.etichetta}>max</Text>
        </View>
      </View>
    </View>
  );

  if (!onPress) return contenuto;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${opponent.nome}: ${opponent.creditiResidui} crediti, può offrire fino a ${massimo}, ${rimasti} slot da riempire`}
    >
      {contenuto}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  riga: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  rigaMia: {
    backgroundColor: withAlpha(colors.surfaceRaised, 0.5),
  },
  intestazione: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nome: {
    color: colors.textSecondary,
    fontSize: typography.body.fontSize,
    fontWeight: '600',
  },
  nomeMio: {
    color: colors.textPrimary,
    fontWeight: '800',
  },
  tu: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  completa: {
    color: colors.textMuted,
    fontSize: 10,
  },
  numeri: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  numero: {
    alignItems: 'flex-end',
    minWidth: 38,
  },
  valore: {
    color: colors.textPrimary,
    fontSize: typography.heading.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  valoreSecondario: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  etichetta: {
    color: colors.textMuted,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});

export const TeamRow = memo(TeamRowComponent);
