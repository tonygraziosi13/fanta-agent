import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topDefendersModifierTool } from '@/agent/tools/topDefendersModifier';
import { annullaAcquisto, registraAcquisto } from '@/core/middleware/hooks/auctionHook';
import { readDevSeed } from '@/core/parsing/statoAstaSeed';
import { syncFromRemote } from '@/core/sync/syncService';
import { offertaMassima, type Opponent } from '@/domain/opponent';
import type { Player } from '@/domain/player';
import { ROLE_COLORS, ROLE_LABELS } from '@/domain/roles';
import { selectSvincolati } from '@/state/auctionSelectors';
import { useConfigurationsStore } from '@/state/useConfigurationsStore';
import { useOpponentsStore } from '@/state/useOpponentsStore';
import { usePlayerStatsStore } from '@/state/usePlayerStatsStore';
import { usePlayersStore } from '@/state/usePlayersStore';
import { useSyncStore } from '@/state/useSyncStore';
import { BottomSheet } from '@/ui/components/BottomSheet';
import { EmptyState } from '@/ui/components/EmptyState';
import { ContenderStrip } from '@/ui/components/auction/ContenderStrip';
import { PriceStepper } from '@/ui/components/auction/PriceStepper';
import { SlotGrid } from '@/ui/components/auction/SlotGrid';
import { TeamRow } from '@/ui/components/auction/TeamRow';
import { UpdateButton, type Esito } from '@/ui/components/auction/UpdateButton';
import { colors, elevation, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Asta Live.
 *
 * --- Il mestiere di questa schermata ---
 * Non e' "valutare un giocatore": quello lo fa il dettaglio calciatore. Qui il
 * lavoro e' **registrare quel che e' appena successo senza sbagliare, vedendo
 * intanto se ci si puo' ancora permettere di combattere**. Sono due cose in
 * tensione — inserimento sotto pressione e consapevolezza della situazione — e
 * la schermata le tiene separate in due stati.
 *
 *   In attesa   il tavolo, la propria rosa, la ricerca in evidenza.
 *   In asta     il giocatore chiamato prende la testa, con prezzo e contendenti.
 *
 * --- La scelta strutturale, e il rischio che porta ---
 * L'inserimento viene **prima** del cruscotto. La forma consueta sarebbe una
 * tabella con l'inserimento nascosto in una finestra modale; qui e' invertita,
 * perche' durante un'asta si passa il novanta per cento del tempo a registrare,
 * non a contemplare. Il tavolo resta sotto, a un pollice di distanza.
 *
 * --- Il filo cromatico ---
 * Il colore del **ruolo del giocatore in asta** tinge la testa della schermata,
 * come gia' accade nel dettaglio calciatore. Non e' un accento inventato: e'
 * `domain/roles.ts`, dove P giallo / D verde / C blu / A rosso e' un criterio di
 * accettazione. Un difensore chiamato tinge di verde, un attaccante di rosso, e
 * il reparto si riconosce prima di leggere il nome.
 */
export default function AstaLiveScreen() {
  const insets = useSafeAreaInsets();

  const players = usePlayersStore((s) => s.players);
  const opponents = useOpponentsStore((s) => s.items);
  const config = useConfigurationsStore((s) =>
    s.activeId === null ? undefined : s.byId[s.activeId]
  );

  const [selezionato, setSelezionato] = useState<Player | null>(null);
  const [prezzo, setPrezzo] = useState(1);
  const [query, setQuery] = useState('');
  const [sheetAperto, setSheetAperto] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<{ player: Player; opponent: Opponent } | null>(null);
  const [consigli, setConsigli] = useState<Consiglio[] | null>(null);
  const [caricoConsigli, setCaricoConsigli] = useState(false);

  const svincolati = useMemo(() => selectSvincolati(players, opponents), [players, opponents]);
  const mia = opponents.find((o) => o.isMe);

  const risultati = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return svincolati
      .filter((p) => p.nome.toLowerCase().includes(q) || p.squadra.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, svincolati]);

  const totali = useMemo(
    () =>
      config
        ? { P: config.slots.P, D: config.slots.D, C: config.slots.C, A: config.slots.A }
        : { P: 3, D: 8, C: 8, A: 6 },
    [config]
  );

  const accent = selezionato ? ROLE_COLORS[selezionato.r] : colors.accent;

  /**
   * Chiede al motore i difensori da modificatore.
   *
   * Passa dal **tool dell'agente**, non da una copia della logica: e' la stessa
   * funzione che l'LLM invochera' quando ci sara' il runtime, quindi il pulsante
   * e la futura risposta a voce non possono dare due classifiche diverse.
   *
   * Dichiarata **sopra il return anticipato**: un hook dopo un `return`
   * condizionale viene chiamato solo in alcuni render, e React se ne accorge a
   * runtime con un errore che parla d'altro. TypeScript non lo intercetta.
   */
  const chiediConsigli = useCallback(async () => {
    setCaricoConsigli(true);
    try {
      const esito = (await topDefendersModifierTool.handler({ limite: 8 })) as {
        disponibili: boolean;
        difensori?: Consiglio[];
      };
      setConsigli(esito.disponibili ? (esito.difensori ?? []) : []);
    } finally {
      setCaricoConsigli(false);
    }
  }, []);

  /**
   * Scarica il dataset pubblicato.
   *
   * **Non rigenera niente.** Listone e statistiche si ricostruiscono con
   * `npm run listone` e `npm run dataset`, che girano su un computer e
   * ripubblicano il dataset: da qui si scarica quel che c'e' online. Il
   * sottotitolo del pulsante lo dice, perche' "aggiorna le statistiche"
   * lascerebbe credere che il telefono vada a leggere Understat.
   */
  const aggiornaListone = useCallback(async (): Promise<Esito> => {
    const esito = await syncFromRemote(useSyncStore.getState().setPhase);
    useSyncStore.getState().complete(esito);

    if (esito.status === 'updated') {
      // Le metriche in RAM sono della versione precedente: tenerle mostrerebbe
      // i numeri vecchi su un giocatore gia' aperto finche' l'app non si chiude.
      usePlayerStatsStore.getState().clear();
      await usePlayersStore.getState().load();
      return {
        tipo: 'ok',
        messaggio: `Scaricata la versione ${esito.version.slice(0, 8)}: ${esito.players} calciatori, ${esito.stats} con statistiche.`,
      };
    }

    if (esito.status === 'uptodate') {
      return { tipo: 'niente', messaggio: "Già allineato all'ultima versione pubblicata." };
    }

    return {
      tipo: 'errore',
      messaggio: `${esito.error}${esito.transient ? ' Riprova fra poco.' : ''}`,
    };
  }, []);

  /**
   * Aggiunge le squadre iscritte dopo il primo import.
   *
   * **Aggiunge soltanto**: chi c'e' gia' mantiene crediti e rosa. Sostituire
   * sarebbe corretto solo a asta non iniziata, e un pulsante che azzera due ore
   * di lavoro senza chiedere niente non e' un pulsante, e' una trappola.
   */
  const aggiornaLega = useCallback(async (): Promise<Esito> => {
    const configId = useConfigurationsStore.getState().activeId;
    if (configId === null) {
      return { tipo: 'errore', messaggio: "Nessuna configurazione d'asta attiva." };
    }

    const seme = readDevSeed();
    if (seme === null) {
      return {
        tipo: 'errore',
        messaggio:
          "Nessuno stato d'asta nel pacchetto. Rigeneralo con `npm run asta` e ricostruisci l'app.",
      };
    }

    const esito = await useOpponentsStore.getState().mergeSeed(seme, configId);
    if (!esito.ok) {
      return { tipo: 'errore', messaggio: esito.error ?? 'Aggiornamento non riuscito.' };
    }
    const { aggiunte, rinominate } = esito.esito;
    if (aggiunte.length === 0 && rinominate.length === 0) {
      return { tipo: 'niente', messaggio: 'Nessuna squadra nuova rispetto a quelle già al tavolo.' };
    }

    // Le rinomine si dicono per esteso: una squadra che cambia nome da sola,
    // senza una riga che lo spieghi, sembra sparita e sostituita da un'altra.
    const parti: string[] = [];
    if (aggiunte.length > 0) {
      parti.push(`Aggiunt${aggiunte.length === 1 ? 'a' : 'e'} ${aggiunte.join(', ')}`);
    }
    for (const { da, a } of rinominate) {
      parti.push(`${da} ora si chiama ${a}`);
    }
    return { tipo: 'ok', messaggio: `${parti.join('. ')}.` };
  }, []);

  // --- Gate: senza partecipanti non c'e' asta da seguire.
  if (opponents.length === 0) {
    return (
      <View style={styles.container}>
        <EmptyState
          title="Nessun partecipante"
          message={
            "L'asta ha bisogno di sapere chi c'è al tavolo. Genera lo stato con `npm run asta` e importalo: da lì crediti e rose vivono qui."
          }
        />
      </View>
    );
  }

  function scegli(player: Player) {
    setSelezionato(player);
    // Si parte dalla quotazione, non da 1: e' la base d'asta di fatto, e nove
    // volte su dieci il rilancio parte da li'.
    setPrezzo(Math.max(1, player.qt_a));
    setQuery('');
    setErrore(null);
  }

  function assegna(opponent: Opponent) {
    if (!selezionato) return;

    const esito = registraAcquisto(selezionato.id, prezzo, opponent.id, selezionato.r);
    setSheetAperto(false);

    if (!esito.ok) {
      setErrore(esito.reason ?? 'Assegnazione rifiutata.');
      return;
    }

    // Si tiene solo l'ultima: annullare a catena richiederebbe uno storico, e
    // in asta l'errore che capita e' quello appena fatto.
    setUltimo({ player: selezionato, opponent });
    setSelezionato(null);
    setErrore(null);
  }

  function annulla() {
    if (!ultimo) return;
    const esito = annullaAcquisto(ultimo.player.id, ultimo.opponent.id, ultimo.player.r);
    if (!esito.ok) {
      setErrore(esito.reason ?? 'Annullamento rifiutato.');
      return;
    }
    setUltimo(null);
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {selezionato === null ? (
          <Ricerca
            query={query}
            onQuery={setQuery}
            risultati={risultati}
            rimasti={svincolati.length}
            onScegli={scegli}
          />
        ) : (
          <InAsta
            player={selezionato}
            prezzo={prezzo}
            onPrezzo={setPrezzo}
            opponents={opponents}
            accent={accent}
            onAssegna={() => setSheetAperto(true)}
            onAnnullaScelta={() => {
              setSelezionato(null);
              setErrore(null);
            }}
          />
        )}

        {errore !== null && (
          <View style={styles.errore}>
            <Text style={styles.erroreTesto}>{errore}</Text>
          </View>
        )}

        {ultimo !== null && selezionato === null && (
          <View style={styles.ultimo}>
            <Text style={styles.ultimoTesto} numberOfLines={1}>
              {ultimo.player.nome} a {ultimo.opponent.nome}
            </Text>
            <TouchableOpacity
              onPress={annulla}
              accessibilityRole="button"
              accessibilityLabel={`Annulla l'assegnazione di ${ultimo.player.nome}`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.annulla}>Annulla</Text>
            </TouchableOpacity>
          </View>
        )}

        {selezionato === null && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitolo}>Suggerimenti</Text>
              {consigli !== null && (
                <TouchableOpacity onPress={() => setConsigli(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.cardMeta}>chiudi</Text>
                </TouchableOpacity>
              )}
            </View>

            {consigli === null ? (
              <TouchableOpacity
                onPress={chiediConsigli}
                disabled={caricoConsigli}
                activeOpacity={0.75}
                style={styles.quickAction}
                accessibilityRole="button"
                accessibilityLabel="Mostra i migliori difensori da modificatore ancora liberi"
              >
                {caricoConsigli ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <>
                    <Text style={styles.quickActionTitolo}>Top difensori da modificatore</Text>
                    <Text style={styles.quickActionSotto}>
                      Incrocia la difesa della squadra, l’impostazione e i malus
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : consigli.length === 0 ? (
              <Text style={styles.nessuno}>
                Nessun difensore da valutare: o sono finiti, o mancano le metriche.
              </Text>
            ) : (
              consigli.map((c) => (
                <TouchableOpacity
                  key={c.nome}
                  onPress={() => {
                    const p = svincolati.find((x) => x.nome === c.nome && x.squadra === c.squadra);
                    if (p) scegli(p);
                  }}
                  activeOpacity={0.75}
                  style={styles.consiglio}
                  accessibilityRole="button"
                  accessibilityLabel={`Metti in asta ${c.nome}, indice ${c.indice}`}
                >
                  <View style={styles.barraIndice}>
                    <View
                      style={[
                        styles.barraPiena,
                        { width: `${Math.max(c.indice, 2)}%`, backgroundColor: ROLE_COLORS.D },
                      ]}
                    />
                  </View>
                  <View style={styles.risultatoTesto}>
                    <Text style={styles.risultatoNome} numberOfLines={1}>
                      {c.nome}
                    </Text>
                    <Text style={styles.risultatoMeta} numberOfLines={1}>
                      {c.squadra}
                      {c.contesto.modulo ? ` · ${c.contesto.modulo}` : ''}
                      {c.copertura < 1 ? ` · dati parziali` : ''}
                    </Text>
                  </View>
                  <View style={styles.consiglioNumeri}>
                    <Text style={styles.risultatoQt}>{c.indice}</Text>
                    <Text style={styles.etichettaMini}>{c.costo} cr</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {mia && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitolo}>La tua rosa</Text>
              <Text style={styles.cardCrediti}>
                {mia.creditiResidui} <Text style={styles.cardCreditiUnita}>crediti</Text>
              </Text>
            </View>
            <SlotGrid liberi={mia.slotLiberi} totali={totali} />
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitolo}>Il tavolo</Text>
            <Text style={styles.cardMeta}>{svincolati.length} ancora liberi</Text>
          </View>
          {opponents.map((o) => (
            <TeamRow key={o.id} opponent={o} totali={totali} />
          ))}
        </View>

        {/* --- Preparazione: si preme prima che cominci, non durante.
            In fondo di proposito — a un pollice di scorrimento, fuori dalla
            portata di un tocco distratto mentre il banditore conta. --- */}
        {selezionato === null && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitolo}>Prima di cominciare</Text>
            </View>

            <UpdateButton
              titolo="Aggiorna listone e statistiche"
              sottotitolo="Scarica l'ultimo dataset pubblicato. Per rigenerarlo dalle fonti servono `npm run listone` e `npm run dataset` da computer."
              onPress={aggiornaListone}
            />

            <View style={styles.separatore} />

            <UpdateButton
              titolo="Aggiorna la lega"
              sottotitolo="Aggiunge le squadre iscritte dopo l'ultimo import. Chi è già al tavolo mantiene crediti e rosa."
              onPress={aggiornaLega}
            />
          </View>
        )}
      </ScrollView>

      <BottomSheet
        visible={sheetAperto}
        onClose={() => setSheetAperto(false)}
        title={selezionato ? `${selezionato.nome} a ${prezzo} crediti` : 'Assegna'}
      >
        <View style={styles.sheet}>
          {opponents.map((o) => {
            const massimo = offertaMassima(o);
            const puo = selezionato !== null && o.slotLiberi[selezionato.r] > 0 && massimo >= prezzo;
            return (
              <TouchableOpacity
                key={o.id}
                onPress={() => assegna(o)}
                disabled={!puo}
                activeOpacity={0.75}
                style={[styles.sceltaTeam, !puo && styles.sceltaTeamSpenta]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !puo }}
                accessibilityLabel={
                  puo
                    ? `Assegna a ${o.nome}`
                    : `${o.nome} non può: ${selezionato && o.slotLiberi[selezionato.r] <= 0 ? 'reparto completo' : `può offrire al massimo ${massimo}`}`
                }
              >
                <Text style={[styles.sceltaNome, !puo && styles.sceltaSpenta]}>
                  {o.nome}
                  {o.isMe ? ' · tu' : ''}
                </Text>
                <Text style={[styles.sceltaMax, !puo && styles.sceltaSpenta]}>
                  {selezionato && o.slotLiberi[selezionato.r] <= 0 ? 'reparto pieno' : `max ${massimo}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </BottomSheet>
    </>
  );
}

/** Stato "in attesa": la ricerca in evidenza, perche' e' l'unica cosa da fare. */
function Ricerca({
  query,
  onQuery,
  risultati,
  rimasti,
  onScegli,
}: {
  query: string;
  onQuery: (q: string) => void;
  risultati: Player[];
  rimasti: number;
  onScegli: (p: Player) => void;
}) {
  return (
    <View style={[styles.card, elevation.card]}>
      <Text style={styles.eyebrow}>Chi è stato chiamato</Text>

      <TextInput
        value={query}
        onChangeText={onQuery}
        placeholder="Cerca fra gli svincolati…"
        placeholderTextColor={colors.textMuted}
        style={styles.ricerca}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Cerca il calciatore chiamato in asta"
      />

      {query.trim().length >= 2 && risultati.length === 0 && (
        <Text style={styles.nessuno}>
          Nessuno svincolato con questo nome. Potrebbe essere già stato aggiudicato.
        </Text>
      )}

      {risultati.map((p) => (
        <TouchableOpacity
          key={p.id}
          onPress={() => onScegli(p)}
          activeOpacity={0.75}
          style={styles.risultato}
          accessibilityRole="button"
          accessibilityLabel={`Metti in asta ${p.nome}, ${ROLE_LABELS[p.r]} del ${p.squadra}`}
        >
          <View style={[styles.pallino, { backgroundColor: ROLE_COLORS[p.r] }]} />
          <View style={styles.risultatoTesto}>
            <Text style={styles.risultatoNome} numberOfLines={1}>
              {p.nome}
            </Text>
            <Text style={styles.risultatoMeta} numberOfLines={1}>
              {p.squadra}
            </Text>
          </View>
          <Text style={styles.risultatoQt}>{p.qt_a}</Text>
        </TouchableOpacity>
      ))}

      {query.trim().length < 2 && (
        <Text style={styles.suggerimento}>
          {rimasti} calciatori ancora da assegnare. Scrivi almeno due lettere.
        </Text>
      )}
    </View>
  );
}

/** Stato "in asta": il chiamato prende la testa della schermata. */
function InAsta({
  player,
  prezzo,
  onPrezzo,
  opponents,
  accent,
  onAssegna,
  onAnnullaScelta,
}: {
  player: Player;
  prezzo: number;
  onPrezzo: (n: number) => void;
  opponents: ReadonlyArray<Opponent>;
  accent: string;
  onAssegna: () => void;
  onAnnullaScelta: () => void;
}) {
  const mia = opponents.find((o) => o.isMe);
  const mioMassimo = mia ? offertaMassima(mia) : null;

  return (
    <View style={[styles.chiamata, { borderColor: withAlpha(accent, 0.4) }, elevation.hero]}>
      <View pointerEvents="none" style={[styles.wash, { backgroundColor: withAlpha(accent, 0.1) }]} />

      <View style={styles.chiamataHeader}>
        <View style={[styles.ruoloChip, { backgroundColor: accent }]}>
          <Text style={styles.ruoloChipTesto}>{player.r}</Text>
        </View>
        <View style={styles.chiamataInfo}>
          <Text style={styles.chiamataNome} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {player.nome}
          </Text>
          <Text style={styles.chiamataMeta} numberOfLines={1}>
            {player.squadra} · quotato {player.qt_a} · FVM {player.fvm}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onAnnullaScelta}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Togli dall'asta"
        >
          <Text style={styles.chiudi}>✕</Text>
        </TouchableOpacity>
      </View>

      <PriceStepper valore={prezzo} onChange={onPrezzo} massimo={mioMassimo} accent={accent} />

      <ContenderStrip opponents={opponents} ruolo={player.r} prezzo={prezzo} accent={accent} />

      <TouchableOpacity
        onPress={onAssegna}
        activeOpacity={0.8}
        style={[styles.assegna, { backgroundColor: accent }]}
        accessibilityRole="button"
        accessibilityLabel={`Aggiudica ${player.nome} a ${prezzo} crediti`}
      >
        <Text style={styles.assegnaTesto}>Aggiudica a {prezzo}</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Quel che il tool restituisce, ridotto a cio' che questa schermata mostra. */
interface Consiglio {
  nome: string;
  squadra: string;
  costo: number;
  indice: number;
  copertura: number;
  contesto: { modulo: string | null };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  quickAction: {
    minHeight: 56,
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
  },
  quickActionTitolo: {
    color: colors.textPrimary,
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '700',
  },
  quickActionSotto: { color: colors.textMuted, fontSize: typography.caption.fontSize },
  consiglio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  // Una barra sottile e verticale invece di un numero in cerchio: l'indice e'
  // una posizione relativa, e una barra la mostra per quel che e'.
  barraIndice: {
    width: 3,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.surfaceRaised, 0.8),
    justifyContent: 'flex-end',
    overflow: 'hidden',
    transform: [{ rotate: '180deg' }],
  },
  barraPiena: { width: '100%', height: 3, borderRadius: radius.pill },
  consiglioNumeri: { alignItems: 'flex-end' },
  etichettaMini: { color: colors.textMuted, fontSize: 10 },
  content: { padding: spacing.lg, gap: spacing.md },
  separatore: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(colors.border, 0.9),
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  cardTitolo: {
    color: colors.textSecondary,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
  },
  cardMeta: { color: colors.textMuted, fontSize: typography.caption.fontSize },
  cardCrediti: {
    color: colors.textPrimary,
    fontSize: typography.figure.fontSize,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  cardCreditiUnita: {
    color: colors.textMuted,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
  },

  eyebrow: {
    color: colors.textSecondary,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
  },
  ricerca: {
    color: colors.textPrimary,
    fontSize: typography.title.fontSize,
    fontWeight: '700',
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  suggerimento: { color: colors.textMuted, fontSize: typography.caption.fontSize },
  nessuno: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: 18 },

  risultato: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pallino: { width: 8, height: 8, borderRadius: radius.pill },
  risultatoTesto: { flex: 1, minWidth: 0 },
  risultatoNome: {
    color: colors.textPrimary,
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '700',
  },
  risultatoMeta: { color: colors.textMuted, fontSize: typography.caption.fontSize },
  risultatoQt: {
    color: colors.textSecondary,
    fontSize: typography.heading.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },

  chiamata: {
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.lg,
    overflow: 'hidden',
  },
  wash: { ...StyleSheet.absoluteFillObject },
  chiamataHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ruoloChip: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruoloChipTesto: { color: '#0B1220', fontSize: typography.heading.fontSize, fontWeight: '800' },
  chiamataInfo: { flex: 1, minWidth: 0, gap: 2 },
  chiamataNome: {
    color: colors.textPrimary,
    fontSize: typography.title.fontSize,
    fontWeight: '700',
  },
  chiamataMeta: { color: colors.textSecondary, fontSize: typography.caption.fontSize },
  chiudi: { color: colors.textMuted, fontSize: 20, fontWeight: '700' },

  assegna: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assegnaTesto: {
    color: '#0B1220',
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  errore: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(colors.danger, 0.5),
    backgroundColor: withAlpha(colors.danger, 0.12),
    padding: spacing.md,
  },
  erroreTesto: { color: colors.danger, fontSize: typography.caption.fontSize, lineHeight: 18 },

  ultimo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.surfaceRaised, 0.6),
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  ultimoTesto: { flex: 1, color: colors.textSecondary, fontSize: typography.caption.fontSize },
  annulla: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  sheet: { gap: spacing.xs, paddingBottom: spacing.md },
  sceltaTeam: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.surfaceRaised, 0.5),
  },
  sceltaTeamSpenta: { backgroundColor: 'transparent', opacity: 0.45 },
  sceltaNome: {
    color: colors.textPrimary,
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '700',
  },
  sceltaMax: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontVariant: ['tabular-nums'],
  },
  sceltaSpenta: { color: colors.textMuted, fontWeight: '400' },
});
