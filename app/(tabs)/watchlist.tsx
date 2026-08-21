import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { inflazioneOsservata, proponiAlternative, valutaBudget } from '@/domain/budgetAlert';
import { proponiRiempimento } from '@/domain/watchlistFill';
import { partizionaAggiudicati, presiDaQualcuno, proprietarioDi, selectSvincolati } from '@/state/auctionSelectors';
import { selectGroupedWatchlist } from '@/state/selectors';
import { useCategoriesStore } from '@/state/useCategoriesStore';
import { useOpponentsStore } from '@/state/useOpponentsStore';
import { usePlayersStore } from '@/state/usePlayersStore';
import { useWatchlistStore } from '@/state/useWatchlistStore';
import { CategorySheet } from '@/ui/components/CategorySheet';
import { EmptyState } from '@/ui/components/EmptyState';
import { FillSuggestions } from '@/ui/components/FillSuggestions';
import { PlayerRow } from '@/ui/components/PlayerRow';
import { BudgetAlert } from '@/ui/components/auction/BudgetAlert';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Schermata Watchlist (US5-T3, US6-T1).
 *
 * Accordion invece di tab orizzontali: le categorie sono create dall'utente e
 * possono essere molte piu' di quattro; delle tab andrebbero in overflow, delle
 * sezioni collassabili no.
 *
 * ScrollView e non FlashList: qui i record sono le decine di giocatori scelti
 * dall'utente, non 497. La virtualizzazione annidata dentro sezioni collassabili
 * costerebbe complessita' senza guadagno misurabile.
 *
 * --- Auto-pulizia durante l'asta ---
 * Chi e' gia' stato aggiudicato **sparisce dalla vista**, perche' durante
 * un'asta la watchlist si scorre per scegliere il prossimo obiettivo e un nome
 * gia' venduto e' rumore nel percorso piu' caldo.
 *
 * Sparisce dalla *vista* e non dai dati: l'assegnazione resta, la categoria che
 * l'utente ha scelto non si perde, e se l'aggiudicazione viene annullata il
 * giocatore torna dov'era. Una riga in fondo dice quanti sono nascosti — senza,
 * la watchlist sembrerebbe assottigliarsi da sola — ed e' anche l'interruttore
 * per rivederli, che dopo l'asta e' il modo naturale di ripassare com'e' andata.
 *
 * --- Suggerimenti sulle categorie vuote ---
 * Una categoria appena creata e ancora vuota e' l'unico punto in cui proporre
 * dei nomi non e' un'interruzione: l'utente ha dichiarato un'intenzione e non
 * l'ha ancora riempita. I suggerimenti si calcolano solo li' — su una lista
 * gia' scritta sarebbero un consiglio non richiesto sopra un lavoro fatto — e
 * si accettano uno per uno, dalla stessa `assignPlayer` del Listone.
 */
export default function WatchlistScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const playersById = usePlayersStore((s) => s.byId);
  const allPlayers = usePlayersStore((s) => s.players);
  const assignments = useWatchlistStore((s) => s.assignments);
  const addedAt = useWatchlistStore((s) => s.addedAt);
  const categories = useCategoriesStore((s) => s.categories);

  const opponents = useOpponentsStore((s) => s.items);

  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [sheetPlayerId, setSheetPlayerId] = useState<number | null>(null);
  const [mostraAggiudicati, setMostraAggiudicati] = useState(false);

  const tutti = useMemo(
    () => selectGroupedWatchlist(playersById, assignments, addedAt, categories),
    [playersById, assignments, addedAt, categories]
  );

  const presi = useMemo(() => presiDaQualcuno(opponents), [opponents]);
  const { visibili, aggiudicati } = useMemo(
    () => partizionaAggiudicati(tutti, presi),
    [tutti, presi]
  );

  const groups = mostraAggiudicati ? tutti : visibili;
  const total = groups.reduce((sum, g) => sum + g.count, 0);

  // --- Allarme economico ---
  // Si lavora sui target **ancora liberi**: chi e' gia' stato aggiudicato non e'
  // piu' un obiettivo, e includerlo gonfierebbe il fabbisogno con nomi
  // irraggiungibili — un allarme che scatta per giocatori che non esistono piu'.
  const mia = useMemo(() => opponents.find((o) => o.isMe), [opponents]);
  const budget = useMemo(() => {
    if (!mia) return null;

    const targets = visibili.flatMap((g) => g.players);
    if (targets.length === 0) return null;

    const inflazione = inflazioneOsservata(opponents, playersById);
    const verdict = valutaBudget(mia, targets, inflazione);
    if (verdict.deficit <= 0) return null;

    return {
      verdict,
      alternative: proponiAlternative(
        verdict,
        mia,
        targets,
        selectSvincolati(allPlayers, opponents)
      ),
    };
  }, [mia, visibili, opponents, playersById, allPlayers]);

  // Solo per le categorie ancora vuote: calcolarle per tutte costerebbe un
  // ordinamento di cinquecento nomi per categoria senza che nessuno le guardi.
  const proposte = useMemo(() => {
    const vuote = visibili.filter((g) => g.count === 0).map((g) => g.category);
    if (!mia || vuote.length === 0) return {};

    const elenco = proponiRiempimento(
      vuote,
      selectSvincolati(allPlayers, opponents),
      mia,
      new Set(Object.keys(assignments).map(Number)),
      { inflazione: inflazioneOsservata(opponents, playersById) }
    );

    return Object.fromEntries(elenco.map((p) => [p.categoria.id, p]));
  }, [visibili, mia, allPlayers, opponents, assignments, playersById]);

  const handlePressAssign = useCallback((playerId: number) => {
    // US6-T1: dalla Watchlist il badge riapre il menu, da cui si sposta o si rimuove.
    setSheetPlayerId(playerId);
  }, []);

  // US21-1: il tap sul giocatore apre il dettaglio anche da qui.
  const handlePressDetail = useCallback(
    (playerId: number) => router.push(`/player/${playerId}`),
    [router]
  );

  const closeSheet = useCallback(() => setSheetPlayerId(null), []);

  const toggle = (categoryId: number) =>
    setCollapsed((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
        <View style={styles.toolbar}>
          <Text style={styles.total}>
            {/* Il numero segue quel che si vede: con l'auto-pulizia attiva
                "salvati" sarebbe falso, perche' gli aggiudicati sono ancora
                salvati — solo non piu' acquistabili. */}
            {total}{' '}
            {aggiudicati.length > 0 && !mostraAggiudicati
              ? total === 1
                ? 'ancora disponibile'
                : 'ancora disponibili'
              : total === 1
                ? 'giocatore salvato'
                : 'giocatori salvati'}
          </Text>
          <Link href="/categories" asChild>
            <TouchableOpacity style={styles.manageButton} accessibilityRole="button">
              <Text style={styles.manageLabel}>Gestisci categorie</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {budget !== null && (
          <BudgetAlert
            verdict={budget.verdict}
            alternative={budget.alternative}
            onPressPlayer={handlePressDetail}
          />
        )}

        {total === 0 ? (
          // Due vuoti diversi, e confonderli manderebbe l'utente sul Listone a
          // rifare un lavoro che aveva gia' fatto.
          aggiudicati.length > 0 ? (
            <EmptyState
              icon="🔨"
              title="Sono andati tutti"
              message="Ogni giocatore della tua watchlist è già stato aggiudicato. Restano nelle categorie: tocca la riga qui sotto per rivederli, o torna sul Listone per nuovi obiettivi."
            />
          ) : (
            <EmptyState
              icon="⭐"
              title="Watchlist vuota"
              message="Vai sul Listone e tocca il + accanto a un calciatore per iniziare a costruire la tua strategia."
            />
          )
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed[group.category.id] ?? false;

            return (
              <View key={group.category.id} style={styles.section}>
                <TouchableOpacity
                  onPress={() => toggle(group.category.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !isCollapsed }}
                  style={styles.sectionHeader}
                >
                  <View style={[styles.dot, { backgroundColor: group.category.color }]} />
                  <Text style={styles.sectionTitle}>{group.category.name}</Text>
                  {/* US5: conteggio esatto per ogni gruppo, sempre visibile. */}
                  <View style={[styles.countPill, { borderColor: group.category.color }]}>
                    <Text style={styles.countText}>{group.count}</Text>
                  </View>
                  <Text style={styles.chevron}>{isCollapsed ? '▸' : '▾'}</Text>
                </TouchableOpacity>

                {!isCollapsed &&
                  (group.count === 0 ? (
                    proposte[group.category.id] !== undefined ? (
                      <FillSuggestions
                        proposta={proposte[group.category.id]!}
                        onPressPlayer={handlePressDetail}
                      />
                    ) : (
                      <Text style={styles.emptyCategory}>Nessun giocatore in questa categoria.</Text>
                    )
                  ) : (
                    group.players.map((player) => (
                      <PlayerRow
                        key={player.id}
                        player={player}
                        onPressAssign={handlePressAssign}
                        onPress={handlePressDetail}
                      />
                    ))
                  ))}
              </View>
            );
          })
        )}

        {aggiudicati.length > 0 && (
          <TouchableOpacity
            onPress={() => setMostraAggiudicati((v) => !v)}
            activeOpacity={0.7}
            style={styles.aggiudicati}
            accessibilityRole="button"
            accessibilityState={{ expanded: mostraAggiudicati }}
            accessibilityLabel={
              mostraAggiudicati
                ? 'Nascondi i giocatori già aggiudicati'
                : `Mostra i ${aggiudicati.length} giocatori della watchlist già aggiudicati`
            }
          >
            <Text style={styles.aggiudicatiTesto}>
              {aggiudicati.length}{' '}
              {aggiudicati.length === 1 ? 'della tua lista è' : 'della tua lista sono'} già
              {aggiudicati.length === 1 ? ' andato' : ' andati'} all'asta.{' '}
              <Text style={styles.aggiudicatiAzione}>
                {mostraAggiudicati ? 'Nascondi' : 'Mostra lo stesso'}
              </Text>
            </Text>

            {mostraAggiudicati && (
              <Text style={styles.aggiudicatiDettaglio}>
                {aggiudicati
                  .map((p) => `${p.nome} → ${proprietarioDi(p.id, opponents)?.nome ?? '—'}`)
                  .join(' · ')}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>

      <CategorySheet playerId={sheetPlayerId} onClose={closeSheet} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  total: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
  },
  manageButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  manageLabel: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
  },
  section: {
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
  },
  sectionTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.heading.fontSize,
    fontWeight: '700',
  },
  countPill: {
    minWidth: 26,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
  },
  countText: {
    color: colors.textPrimary,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 14,
  },
  aggiudicati: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  aggiudicatiTesto: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    lineHeight: 18,
  },
  aggiudicatiAzione: {
    color: colors.accent,
    fontWeight: '700',
  },
  aggiudicatiDettaglio: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 17,
  },
  emptyCategory: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontStyle: 'italic',
  },
});
