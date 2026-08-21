import { memo, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { offertaMassima, type Opponent } from '@/domain/opponent';
import type { ClassicRole } from '@/domain/roles';
import { colors, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Chi puo' ancora rilanciare, e fino a quanto.
 *
 * --- L'elemento che questa schermata esiste per mostrare ---
 * Durante un'asta la domanda non e' "quanto vale questo giocatore": e' "posso
 * smettere di preoccuparmi". Un prezzo che sale non dice niente da solo; dice
 * tutto se accanto si vede il tavolo che si svuota.
 *
 * Ogni squadra e' una pastiglia con la sua offerta massima. Man mano che il
 * prezzo sale, le pastiglie si spengono una a una — e quando ne resta una sola
 * accesa, la decisione l'ha presa il tavolo al posto tuo.
 *
 * --- Perche' `offertaMassima` e non i crediti ---
 * Un avversario con 200 crediti e diciannove slot da riempire non puo' offrirne
 * 200: gliene servono comunque diciannove per completare la rosa. Mostrare il
 * totale farebbe sembrare in gara qualcuno che non lo e'. La funzione vive in
 * `domain/opponent.ts` ed e' la stessa che valida la transazione: quel che si
 * vede qui e' esattamente cio' che il motore accettera'.
 *
 * Chi ha il reparto completo esce comunque, a qualunque cifra: non ha piu' dove
 * metterlo.
 */

interface Props {
  opponents: ReadonlyArray<Opponent>;
  /** Ruolo del giocatore in asta: chi ha il reparto pieno e' fuori. */
  ruolo: ClassicRole;
  /** Prezzo corrente: sopra il proprio massimo, la pastiglia si spegne. */
  prezzo: number;
  /** Colore del ruolo: il filo cromatico della schermata. */
  accent: string;
}

interface Contendente {
  id: number;
  nome: string;
  isMe: boolean;
  massimo: number;
  /** Perche' e' fuori. `null` se e' ancora in gara. */
  fuori: 'reparto' | 'crediti' | null;
}

function ContenderStripComponent({ opponents, ruolo, prezzo, accent }: Props) {
  const contendenti = useMemo<Contendente[]>(
    () =>
      opponents
        .map((o) => {
          const massimo = offertaMassima(o);
          const senzaSlot = o.slotLiberi[ruolo] <= 0;
          return {
            id: o.id,
            nome: o.nome,
            isMe: o.isMe,
            massimo,
            fuori: senzaSlot ? 'reparto' : massimo < prezzo ? 'crediti' : null,
          } as Contendente;
        })
        // In gara per primi, poi per capienza: chi puo' farti male sta davanti.
        .sort((a, b) => {
          if ((a.fuori === null) !== (b.fuori === null)) return a.fuori === null ? -1 : 1;
          return b.massimo - a.massimo;
        }),
    [opponents, ruolo, prezzo]
  );

  const inGara = contendenti.filter((c) => c.fuori === null && !c.isMe).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.titolo}>Chi può ancora rilanciare</Text>
        <Text style={[styles.conteggio, inGara === 0 && { color: '#22C55E' }]}>
          {inGara === 0 ? 'nessuno' : `${inGara} avversar${inGara === 1 ? 'io' : 'i'}`}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.fila}
      >
        {contendenti.map((c) => (
          <Pastiglia key={c.id} contendente={c} accent={accent} />
        ))}
      </ScrollView>
    </View>
  );
}

function Pastiglia({ contendente, accent }: { contendente: Contendente; accent: string }) {
  const { nome, massimo, fuori, isMe } = contendente;
  const attivo = fuori === null;

  // La propria squadra prende il colore del ruolo, gli avversari restano
  // neutri: fra nove pastiglie serve poter trovare la propria senza leggere.
  const tinta = isMe ? accent : colors.textSecondary;

  return (
    <View
      style={[
        styles.pastiglia,
        attivo
          ? { borderColor: withAlpha(tinta, isMe ? 0.7 : 0.35), backgroundColor: withAlpha(tinta, isMe ? 0.16 : 0.07) }
          : styles.pastigliaSpenta,
      ]}
      accessibilityRole="text"
      accessibilityLabel={
        attivo
          ? `${nome} può arrivare a ${massimo} crediti`
          : `${nome} è fuori: ${fuori === 'reparto' ? 'reparto completo' : 'crediti insufficienti'}`
      }
    >
      <Text
        style={[styles.nome, attivo ? { color: tinta } : styles.testoSpento]}
        numberOfLines={1}
      >
        {isMe ? `${nome} · tu` : nome}
      </Text>
      <Text style={[styles.massimo, attivo ? { color: colors.textPrimary } : styles.testoSpento]}>
        {fuori === 'reparto' ? 'reparto pieno' : massimo}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  titolo: {
    color: colors.textSecondary,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
  },
  conteggio: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
  },
  fila: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  pastiglia: {
    minWidth: 86,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  pastigliaSpenta: {
    borderColor: withAlpha(colors.border, 0.6),
    backgroundColor: 'transparent',
    // Spegnere invece di nascondere: chi e' uscito deve restare visibile, o non
    // si capisce che il tavolo si sta svuotando.
    opacity: 0.45,
  },
  nome: {
    fontSize: 11,
    fontWeight: '700',
  },
  massimo: {
    fontSize: typography.heading.fontSize,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  testoSpento: {
    color: colors.textMuted,
    fontWeight: '400',
  },
});

export const ContenderStrip = memo(ContenderStripComponent);
