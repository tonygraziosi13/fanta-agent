import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { assignPlayer } from '@/core/middleware/hooks/assignmentHook';
import type { Proposta } from '@/domain/watchlistFill';
import { STRATEGIA_LABELS } from '@/domain/watchlistFill';
import { ROLE_COLORS } from '@/domain/roles';
import { colors, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Suggerimenti per una categoria vuota della watchlist.
 *
 * --- Perche' qui e non altrove ---
 * Una categoria vuota e' l'unico punto in cui il suggerimento non e'
 * un'interruzione: l'utente ha appena dichiarato un'intenzione ("Scommesse") e
 * non l'ha ancora riempita. Sopra una lista gia' scritta sarebbe un consiglio
 * non richiesto sopra un lavoro fatto.
 *
 * --- Si propone, non si aggiunge ---
 * Ogni riga si accetta con un tocco, e quel tocco passa dalla stessa
 * `assignPlayer` del Listone: un'aggiunta suggerita e un'aggiunta manuale
 * restano la stessa operazione, con la stessa validazione e la stessa scrittura.
 * Niente "aggiungi tutti": accettare cinque nomi in blocco e' esattamente il
 * gesto che si fa senza leggerli.
 *
 * Quando non c'e' niente da proporre si dice **perche'** — un elenco vuoto muto
 * sembra uno strumento rotto, e la fascia di prezzo spiega quasi sempre il buco.
 */

interface Props {
  proposta: Proposta;
  /** Apre il dettaglio di un suggerito, per valutarlo prima di accettarlo. */
  onPressPlayer?: (playerId: number) => void;
}

export function FillSuggestions({ proposta, onPressPlayer }: Props) {
  const { categoria, fascia, giocatori, motivo } = proposta;
  const [aperto, setAperto] = useState(false);

  if (giocatori.length === 0) {
    return <Text style={styles.motivo}>{motivo ?? 'Nessun giocatore in questa categoria.'}</Text>;
  }

  if (!aperto) {
    return (
      <TouchableOpacity
        onPress={() => setAperto(true)}
        activeOpacity={0.75}
        style={styles.invito}
        accessibilityRole="button"
        accessibilityLabel={`Vedi ${giocatori.length} suggerimenti per ${categoria.name}`}
      >
        <Text style={styles.invitoTesto}>
          Vuota. <Text style={styles.invitoAzione}>Vedi {giocatori.length} suggerimenti</Text>
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.contenitore}>
      <View style={styles.testa}>
        <Text style={styles.strategia}>{STRATEGIA_LABELS[fascia.strategia]}</Text>
        <Text style={styles.fascia}>
          {fascia.min}–{fascia.max} cr
        </Text>
      </View>

      {giocatori.map((player) => (
        <View key={player.id} style={styles.riga}>
          <View style={[styles.ruolo, { backgroundColor: withAlpha(ROLE_COLORS[player.r], 0.18) }]}>
            <Text style={[styles.ruoloTesto, { color: ROLE_COLORS[player.r] }]}>{player.r}</Text>
          </View>

          <TouchableOpacity
            style={styles.identita}
            activeOpacity={onPressPlayer ? 0.7 : 1}
            onPress={onPressPlayer ? () => onPressPlayer(player.id) : undefined}
            accessibilityRole={onPressPlayer ? 'button' : undefined}
          >
            <Text style={styles.nome} numberOfLines={1}>
              {player.nome}
            </Text>
            <Text style={styles.squadra} numberOfLines={1}>
              {player.squadra} · {player.qt_a} cr · FVM {player.fvm}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => assignPlayer(player.id, categoria.id)}
            activeOpacity={0.7}
            style={styles.aggiungi}
            accessibilityRole="button"
            accessibilityLabel={`Aggiungi ${player.nome} a ${categoria.name}`}
          >
            <Text style={styles.aggiungiTesto}>+</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity onPress={() => setAperto(false)} accessibilityRole="button">
        <Text style={styles.chiudi}>Nascondi i suggerimenti</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  motivo: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontStyle: 'italic',
  },
  invito: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  invitoTesto: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
  },
  invitoAzione: {
    color: colors.accent,
    fontWeight: '700',
  },

  contenitore: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  testa: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  strategia: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 11,
  },
  fascia: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },

  riga: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  ruolo: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruoloTesto: { fontSize: 11, fontWeight: '800' },
  identita: { flex: 1 },
  nome: {
    color: colors.textPrimary,
    fontSize: typography.body.fontSize,
    fontWeight: '600',
  },
  squadra: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  aggiungi: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aggiungiTesto: {
    color: colors.accent,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },

  chiudi: {
    color: colors.textMuted,
    fontSize: 11,
    paddingTop: spacing.xs,
  },
});
