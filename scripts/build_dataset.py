#!/usr/bin/env python3
"""
Genera il dataset arricchito consumato dall'app (US19).

    python scripts/build_dataset.py                      # tutte le fonti
    python scripts/build_dataset.py --only understat     # una sola
    python scripts/build_dataset.py --limit 30           # prova rapida
    python scripts/build_dataset.py --no-cache           # ignora la cache su disco
    python scripts/build_dataset.py --full               # ignora il delta, rifa' tutto

Orchestrazione e nient'altro: non conosce nessuna fonte in concreto, itera sul
registro dei provider e affida il merge a `builder.py`. Aggiungere una fonte non
tocca questo file.

--- Le due cose che questo file sa, e i provider no ---
1. La **cascata**: passa a ogni fonte un `CascadeState` che dice cosa i livelli
   precedenti hanno gia' coperto, e lo aggiorna dopo ognuna. E' cosi' che FBref
   scopre di dover girare su trenta giocatori invece che su cinquecento, senza
   sapere che Understat esiste.
2. Il **delta**: chi era gia' coperto nella corsa precedente non viene
   rielaborato, e il suo record si riprende dal dataset di ieri. La regola sta
   in `delta.py`, qui c'e' solo il cablaggio.

Una fonte che fallisce non fa fallire la generazione: il dataset esce con quella
copertura in meno e il report lo dice a voce alta. L'alternativa — nessun
dataset perche' un sito era offline — sarebbe peggiore per l'utente. E' anche il
motivo per cui esiste `scripts/check_release.py`: questo script ritorna 0
comunque, e a monte di un commit automatico serve qualcuno che dica di no.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

# La console di Windows parte in cp1252 e va in UnicodeEncodeError sui nomi
# accentati (e sulle frecce del report). Si forza UTF-8 sull'output, con
# `replace` come rete: un accento illeggibile non deve interrompere una
# generazione durata dieci minuti.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

from dataset import config, delta as delta_mod, providers, report
from dataset.builder import build_records
from dataset.export import build_payload, write_dataset
from dataset.http import HttpClient
from dataset.model import CascadeState
from dataset.providers.base import ProviderOutcome
from dataset.roster import load_roster


def load_manual_map() -> dict[str, dict[str, str]]:
    if not config.MANUAL_MAP.exists():
        return {}
    raw = json.loads(config.MANUAL_MAP.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if isinstance(v, dict)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera dataset/players.json")
    parser.add_argument("--only", help="fonti separate da virgola (understat,transfermarkt,...)")
    parser.add_argument("--limit", type=int, help="usa solo i primi N giocatori del listone")
    parser.add_argument("--no-cache", action="store_true", help="ignora la cache HTTP su disco")
    parser.add_argument(
        "--full",
        action="store_true",
        help="ignora il delta e rielabora tutto il listone",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="sovrascrivi dataset/ anche con un'esecuzione parziale (--only/--limit)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=config.DEFAULT_DELAY_SECONDS,
        help="secondi fra due richieste allo stesso host",
    )
    args = parser.parse_args()

    roster = load_roster()
    if args.limit:
        roster = roster[: args.limit]
    print(f"Listone: {len(roster)} giocatori da {config.LISTONE_CSV.name}")

    selected = providers.select(args.only.split(",") if args.only else None)
    if not selected:
        print(f"Nessuna fonte corrisponde a '{args.only}'.", file=sys.stderr)
        return 2

    # --- Delta: chi va davvero rielaborato ---------------------------------
    #
    # Un'esecuzione parziale non puo' alimentare il delta: `--only understat`
    # produce schede senza infortuni, e registrarle come "fatte" le
    # escluderebbe per sempre dalle corse complete.
    parziale = bool(args.only or args.limit)
    precedente = delta_mod.load_previous_payload()
    stato = delta_mod.load_state()
    piano = delta_mod.plan(
        roster, precedente, stato, full=args.full or parziale
    )

    if piano.saltati:
        print(
            f"Delta: {len(piano.da_rifare)} da rielaborare, "
            f"{piano.saltati} ripresi dalla corsa precedente."
        )
    if not piano.da_rifare:
        print("Nessun giocatore da rielaborare: il dataset e' gia' aggiornato.")

    # --- La cascata ---------------------------------------------------------
    #
    # Con il delta vuoto le fonti non vengono nemmeno interpellate, e il blocco
    # `sources` resterebbe vuoto: il gate di rilascio lo leggerebbe come "tutte
    # le fonti sparite dal payload", cioe' una regressione, e bloccherebbe la
    # pubblicazione di un dataset perfettamente intatto. Si riporta quindi la
    # copertura dichiarata dalla corsa precedente — che e' anche la verita': non
    # avendo ricontattato nessuno, la copertura e' esattamente quella di ieri.
    state = CascadeState()
    outcomes: dict[str, ProviderOutcome] = {}
    sources_precedenti: dict[str, Any] | None = None

    if not piano.da_rifare and precedente is not None:
        sources_precedenti = precedente.get("sources") or {}

    for provider in selected if piano.da_rifare else ():
        print(f"\n→ {provider.name} …", flush=True)
        try:
            outcome = provider.collect(piano.da_rifare, http_client(args), manual_map(), state)
        except Exception as error:  # una fonte rotta non ferma le altre
            outcome = ProviderOutcome(failure=f"{type(error).__name__}: {error}")
            outcome.unresolved = list(piano.da_rifare)

        outcomes[provider.name] = outcome
        # Il passaggio del testimone: da qui in poi le fonti successive sanno
        # che questi giocatori sono coperti, e possono risparmiarsi le richieste.
        state.absorb(outcome.contributions)

        if outcome.failure:
            print(f"   fallita: {outcome.failure}")
        else:
            print(f"   {len(outcome.contributions)} giocatori coperti")

    records = build_records(
        piano.da_rifare, {name: o.contributions for name, o in outcomes.items()}
    )
    nuovi = {record.entry.id: record.to_json() for record in records}

    # --- Ricomposizione: i nuovi piu' quelli ripresi, nell'ordine del listone
    players: list[dict[str, Any]] = []
    for entry in roster:
        record = nuovi.get(entry.id) or piano.riusati.get(entry.id)
        if record is not None:
            players.append(record)

    # La copertura dichiarata e' quella del dataset finale, non della corsa: con
    # il delta le due divergono, e nel payload deve finire la prima o il gate di
    # rilascio leggerebbe ogni corsa incrementale come un crollo.
    #
    # `complete_run` dice se la corsa ha attraversato tutto il listone. Quando
    # non l'ha fatto, strategie e fallimenti si riportano dalla volta prima:
    # sono la provenienza dei record ripresi, e ricalcolarli su una corsa da
    # dieci giocatori cambierebbe l'hash senza che un solo dato sia cambiato.
    payload = build_payload_from_players(
        players,
        sources_precedenti
        if sources_precedenti is not None
        else report.summarize_dataset(
            players,
            outcomes,
            previous=(precedente or {}).get("sources"),
            complete_run=len(piano.da_rifare) == len(roster),
        ),
    )

    # Una prova non deve poter distruggere il dataset buono.
    #
    # `--only understat --limit 30` e' la prova rapida documentata, ma scriveva
    # sopra dataset/players.json un payload con 30 giocatori e una fonte sola:
    # le altre coperture sparivano senza che nulla lo dicesse. Il gate di
    # rilascio l'avrebbe intercettato prima della pubblicazione, ma il file in
    # locale era gia' perso. Le esecuzioni parziali scrivono quindi altrove, e
    # lo dicono; `--force` resta per chi sa di volerlo davvero.
    destinazione = config.OUTPUT_DIR
    if parziale and not args.force:
        destinazione = config.OUTPUT_DIR / "preview"

    manifest = write_dataset(payload, output_dir=destinazione)

    # Lo stato del delta si aggiorna solo per chi e' passato dalla cascata in
    # questa corsa, e solo se la corsa era completa: gli altri conservano quello
    # che avevano.
    if not parziale:
        for record in players:
            player_id = str(record.get("id"))
            if int(player_id) in nuovi:
                piano.stato[player_id] = delta_mod.classify(
                    record, record.get("coverage") or {}
                )
        delta_mod.save_state(piano.stato)

    # Il report a schermo guarda invece la corsa: e' li' che si legge quali
    # giocatori sono rimasti irrisolti *adesso*, che e' la lista di lavoro per
    # manual_map.json.
    report.print_report(len(piano.da_rifare), outcomes)
    if piano.saltati:
        print(
            f"  ({piano.saltati} giocatori ripresi dalla corsa precedente, "
            "non ricontattati; usa --full per rifarli)\n"
        )
    print(
        f"Scritti {destinazione / config.OUTPUT_PAYLOAD.name} "
        f"({manifest['size_bytes'] / 1024:.0f} KB) e {config.OUTPUT_MANIFEST.name}\n"
        f"versione {manifest['version']} — {manifest['players_count']} giocatori"
    )
    if destinazione != config.OUTPUT_DIR:
        print(
            "\nEsecuzione parziale: il dataset in dataset/ non e' stato toccato.\n"
            "Per sovrascriverlo davvero, rilancia con --force."
        )
    return 0


def build_payload_from_players(
    players: list[dict[str, Any]], sources: dict[str, Any]
) -> dict[str, Any]:
    """
    Il payload attorno a record gia' serializzati.

    `export.build_payload` parte da `PlayerRecord`; qui i record arrivano da due
    posti — quelli appena costruiti e quelli ripresi dal dataset precedente, che
    sono gia' JSON e non hanno piu' un oggetto Python dietro.
    """
    payload = build_payload([], sources)
    payload["players"] = players
    return payload


_http: HttpClient | None = None
_manual: dict[str, dict[str, str]] | None = None


def http_client(args: argparse.Namespace) -> HttpClient:
    """Una sola istanza per esecuzione: la cache e i limiti per host vivono li'."""
    global _http
    if _http is None:
        _http = HttpClient(delay=args.delay, use_cache=not args.no_cache)
    return _http


def manual_map() -> dict[str, dict[str, str]]:
    global _manual
    if _manual is None:
        _manual = load_manual_map()
    return _manual


if __name__ == "__main__":
    raise SystemExit(main())
