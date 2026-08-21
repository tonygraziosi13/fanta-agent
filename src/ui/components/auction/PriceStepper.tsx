import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Il prezzo di aggiudicazione.
 *
 * --- Perche' e' composto grande quanto il FVM ---
 * E' lo stesso mestiere: il numero su cui si sta decidendo. Il dettaglio
 * calciatore usa 46px tabulari per il FantaValore, e riusarli qui fa si' che
 * "il numero che conta" si legga uguale in tutta l'applicazione.
 *
 * --- Perche' i pulsanti e non solo la tastiera ---
 * In asta si rilancia di uno, e aprire la tastiera per cambiare una cifra
 * costa un gesto e mezzo secondo di attenzione tolti al banditore. I pulsanti
 * coprono il caso frequente; il campo resta digitabile per quando qualcuno
 * spara 87 dal nulla.
 *
 * `+5` e `-5` sono la seconda velocita': un rilancio a cinque e' comune quanto
 * quello a uno, e farlo con cinque tocchi e' esattamente il genere di attrito
 * che fa sbagliare cifra.
 */

interface Props {
  valore: number;
  onChange: (valore: number) => void;
  /** Oltre questo, la squadra scelta non potrebbe pagare. */
  massimo: number | null;
  /** Colore del ruolo del giocatore in asta. */
  accent: string;
}

export function PriceStepper({ valore, onChange, massimo, accent }: Props) {
  const oltre = massimo !== null && valore > massimo;

  const cambia = (delta: number) => onChange(Math.max(0, valore + delta));

  return (
    <View style={styles.container}>
      <View style={styles.riga}>
        <Bottone etichetta="−5" onPress={() => cambia(-5)} accent={accent} />
        <Bottone etichetta="−1" onPress={() => cambia(-1)} accent={accent} />

        <View style={styles.campo}>
          <TextInput
            value={String(valore)}
            onChangeText={(testo) => {
              // Solo cifre: una virgola o un segno meno digitati per sbaglio
              // produrrebbero NaN, che il motore rifiuterebbe con un messaggio
              // che parla d'altro.
              const pulito = testo.replace(/[^0-9]/g, '');
              onChange(pulito === '' ? 0 : Number(pulito));
            }}
            keyboardType="number-pad"
            selectTextOnFocus
            style={[styles.numero, oltre && styles.numeroOltre]}
            accessibilityLabel="Prezzo di aggiudicazione"
            maxLength={4}
          />
          <Text style={styles.unita}>crediti</Text>
        </View>

        <Bottone etichetta="+1" onPress={() => cambia(1)} accent={accent} />
        <Bottone etichetta="+5" onPress={() => cambia(5)} accent={accent} />
      </View>

      {oltre && (
        <Text style={styles.avviso}>
          Oltre il massimo di questa squadra ({massimo}).
        </Text>
      )}
    </View>
  );
}

function Bottone({
  etichetta,
  onPress,
  accent,
}: {
  etichetta: string;
  onPress: () => void;
  accent: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.bottone, { borderColor: withAlpha(accent, 0.4) }]}
      accessibilityRole="button"
      accessibilityLabel={`Cambia prezzo di ${etichetta}`}
    >
      <Text style={[styles.bottoneTesto, { color: accent }]}>{etichetta}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  riga: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  bottone: {
    // 44pt: sotto, il bersaglio diventa difficile da centrare col telefono in
    // una mano mentre si ascolta un rilancio.
    minWidth: 44,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottoneTesto: {
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  campo: {
    flex: 1,
    alignItems: 'center',
  },
  numero: {
    color: colors.textPrimary,
    fontSize: typography.display.fontSize,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    lineHeight: typography.display.fontSize * 1.05,
    textAlign: 'center',
    minWidth: 110,
    padding: 0,
  },
  numeroOltre: {
    color: colors.danger,
  },
  unita: {
    color: colors.textMuted,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
  },
  avviso: {
    color: colors.danger,
    fontSize: typography.caption.fontSize,
    textAlign: 'center',
  },
});
