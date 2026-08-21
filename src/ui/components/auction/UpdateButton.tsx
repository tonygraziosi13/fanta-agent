import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Un'azione di aggiornamento, col suo esito accanto.
 *
 * --- Perche' l'esito sta qui e non in un avviso a comparsa ---
 * Un aggiornamento riuscito e un aggiornamento che non aveva niente da fare si
 * assomigliano moltissimo: in entrambi i casi non cambia niente sullo schermo.
 * Senza una riga che dica quale dei due e' stato, si preme il pulsante una
 * seconda volta per sicurezza — e a un'asta che sta per cominciare quella e'
 * attenzione tolta al banditore.
 *
 * L'esito resta finche' non si ripreme: sparire dopo tre secondi
 * significherebbe perderlo proprio nel momento in cui si sta guardando altrove.
 */

export type Esito =
  | { tipo: 'ok'; messaggio: string }
  | { tipo: 'niente'; messaggio: string }
  | { tipo: 'errore'; messaggio: string };

interface Props {
  titolo: string;
  /** Cosa fa davvero, in una riga. Non uno slogan: un chiarimento. */
  sottotitolo: string;
  onPress: () => Promise<Esito>;
}

export function UpdateButton({ titolo, sottotitolo, onPress }: Props) {
  const [inCorso, setInCorso] = useState(false);
  const [esito, setEsito] = useState<Esito | null>(null);

  async function premi() {
    setInCorso(true);
    setEsito(null);
    try {
      setEsito(await onPress());
    } catch (error) {
      setEsito({
        tipo: 'errore',
        messaggio: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setInCorso(false);
    }
  }

  return (
    <View style={styles.blocco}>
      <TouchableOpacity
        onPress={premi}
        disabled={inCorso}
        activeOpacity={0.75}
        style={[styles.bottone, inCorso && styles.bottoneInCorso]}
        accessibilityRole="button"
        accessibilityState={{ busy: inCorso }}
        accessibilityLabel={`${titolo}. ${sottotitolo}`}
      >
        <View style={styles.testi}>
          <Text style={styles.titolo}>{titolo}</Text>
          <Text style={styles.sottotitolo}>{sottotitolo}</Text>
        </View>
        {inCorso ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Text style={styles.freccia}>↻</Text>
        )}
      </TouchableOpacity>

      {esito !== null && (
        <Text
          style={[
            styles.esito,
            esito.tipo === 'ok' && styles.esitoOk,
            esito.tipo === 'errore' && styles.esitoErrore,
          ]}
        >
          {esito.messaggio}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  blocco: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  bottone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // 56pt: si preme prima di un'asta, spesso in piedi e di fretta.
    minHeight: 56,
  },
  bottoneInCorso: {
    opacity: 0.6,
  },
  testi: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titolo: {
    color: colors.textPrimary,
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '700',
  },
  sottotitolo: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    lineHeight: 16,
  },
  freccia: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: '700',
  },
  esito: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    lineHeight: 17,
    paddingLeft: spacing.xs,
    borderLeftWidth: 2,
    borderLeftColor: withAlpha(colors.border, 0.9),
  },
  esitoOk: {
    color: '#22C55E',
    borderLeftColor: '#22C55E',
  },
  esitoErrore: {
    color: colors.danger,
    borderLeftColor: colors.danger,
  },
});
