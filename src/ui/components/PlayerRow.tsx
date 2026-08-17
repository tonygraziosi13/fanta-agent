import { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Player } from '@/domain/player';
import { parseMantraRoles } from '@/domain/roles';
import { useCategory } from '@/state/useCategoriesStore';
import { useAssignedCategoryId } from '@/state/useWatchlistStore';
import { colors, radius, spacing, typography, PLAYER_ROW_HEIGHT } from '@/ui/theme/theme';
import { RoleBadge } from './RoleBadge';

/**
 * Riga del listone (US1-T2 + US3-T1 + US4-T1).
 *
 * --- Il punto critico di tutto lo Sprint (US4-T2) ---
 * Il componente NON riceve lo stato di assegnazione come prop. Se lo ricevesse,
 * assegnare un giocatore cambierebbe la mappa globale, il componente padre si
 * ri-renderizzerebbe e con lui tutte le 497 righe: framerate a terra, esattamente
 * cio' che la US vieta.
 *
 * Invece ogni riga si sottoscrive da sola alla PROPRIA chiave
 * (`useAssignedCategoryId(player.id)`). Zustand confronta il valore restituito
 * riga per riga: chi ottiene lo stesso valore di prima non si ri-renderizza.
 * Assegnando un giocatore si ridisegna una sola riga.
 *
 * `memo` chiude il cerchio sul percorso opposto: impedisce i re-render indotti
 * dal padre quando cambia la lista filtrata ma la riga e' la stessa.
 */

interface Props {
  player: Player;
  /** Riceve l'id: passare il Player intero creerebbe una closure nuova per riga. */
  onPressAssign: (playerId: number) => void;
  /**
   * Apre il dettaglio (US21-1). Separata da `onPressAssign` di proposito: il
   * corpo della riga naviga, il pulsante a destra assegna. Sovrapporre le due
   * azioni renderebbe impossibile assegnare senza prima aprire una schermata.
   */
  onPress?: (playerId: number) => void;
}

function PlayerRowComponent({ player, onPressAssign, onPress }: Props) {
  const categoryId = useAssignedCategoryId(player.id);
  const category = useCategory(categoryId);

  const mantra = parseMantraRoles(player.rm);

  return (
    <View style={styles.row}>
      {/*
        US21-1: il corpo della riga apre il dettaglio. `TouchableOpacity` con
        activeOpacity alta perche' e' un'area grande — un lampeggio marcato su
        mezza riga durante lo scroll darebbe l'impressione di aver toccato per
        sbaglio.
      */}
      <TouchableOpacity
        style={styles.body}
        onPress={onPress === undefined ? undefined : () => onPress(player.id)}
        disabled={onPress === undefined}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${player.nome}, ${player.squadra}. Apri il dettaglio.`}
      >
        <RoleBadge role={player.r} />

        <View style={styles.info}>
          {/* US1-T2: nome in grassetto, squadra come testo secondario ridotto. */}
          <Text style={styles.name} numberOfLines={1}>
            {player.nome}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {player.squadra}
            {mantra.length > 0 ? ` · ${mantra.join('/')}` : ''}
            {!player.is_active ? ' · CEDUTO' : ''}
          </Text>
        </View>

        <View style={styles.quotes}>
          <Text style={styles.quote}>{player.qt_a}</Text>
          <Text style={styles.quoteLabel}>FVM {player.fvm}</Text>
        </View>
      </TouchableOpacity>

      {/*
        US1-T2 riservava qui un contenitore vuoto per la selezione di US3.
        US3-T1/US4-T1 lo riempiono: "+" se libero, badge della categoria se assegnato.
        hitSlop generoso — US3-T1 chiede un touch target ampio per non far
        scattare l'assegnazione durante lo scroll verticale.
      */}
      <TouchableOpacity
        onPress={() => onPressAssign(player.id)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={
          category
            ? `${player.nome}, categoria ${category.name}. Tocca per modificare.`
            : `Aggiungi ${player.nome} a una categoria`
        }
        style={[
          styles.action,
          category
            ? { backgroundColor: category.color, borderColor: category.color }
            : styles.actionEmpty,
        ]}
      >
        {category ? (
          <Text style={styles.actionCheck}>✓</Text>
        ) : (
          <Text style={styles.actionPlus}>+</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

/**
 * Comparatore esplicito.
 * Il default di memo confronterebbe anche `onPressAssign` e `onPress`: le
 * schermate le stabilizzano con useCallback, ma dipendere da quella disciplina
 * a distanza e' fragile. Qui si dichiara cosa conta davvero — e i dati del
 * giocatore cambiano solo dopo un re-import del listone o un sync.
 *
 * Le due callback restano fuori dal confronto di proposito. Se un domani una
 * riga dovesse comparire in una schermata dove passa `onPress` e in un'altra
 * dove non lo passa, e le due condividessero un'istanza riciclata da FlashList,
 * andrebbe aggiunto qui il confronto sulla *presenza* delle callback.
 */
function areEqual(prev: Props, next: Props): boolean {
  return (
    prev.player.id === next.player.id &&
    prev.player.qt_a === next.player.qt_a &&
    prev.player.is_active === next.player.is_active
  );
}

const styles = StyleSheet.create({
  row: {
    height: PLAYER_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // L'area premibile occupa tutta la riga tranne il pulsante di assegnazione:
  // il bersaglio grande e' cio' che rende il tap affidabile durante lo scroll.
  body: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: colors.textPrimary,
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '700',
  },
  meta: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
  },
  quotes: {
    alignItems: 'flex-end',
    minWidth: 46,
  },
  quote: {
    color: colors.textPrimary,
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  quoteLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  action: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionEmpty: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  actionPlus: {
    color: colors.textSecondary,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '600',
  },
  actionCheck: {
    color: '#0B1220',
    fontSize: 16,
    fontWeight: '900',
  },
});

export const PlayerRow = memo(PlayerRowComponent, areEqual);
