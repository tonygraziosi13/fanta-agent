"""
Report di copertura.

Non e' logging decorativo: la lista degli irrisolti e' il materiale di lavoro
per `manual_map.json`, e la percentuale di copertura per fonte e' l'unico modo
di accorgersi che una fonte ha cambiato struttura HTML — nessuna eccezione
verrebbe sollevata, semplicemente i match crollerebbero a zero.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence

from .model import RosterEntry
from .providers.base import ProviderOutcome


def summarize(
    roster_size: int, outcomes: dict[str, ProviderOutcome]
) -> dict[str, dict[str, Any]]:
    summary: dict[str, dict[str, Any]] = {}
    for name, outcome in outcomes.items():
        matched = len(outcome.contributions)
        summary[name] = {
            "matched": matched,
            "coverage": round(matched / roster_size, 3) if roster_size else 0.0,
            "unresolved": len(outcome.unresolved),
            "failed": outcome.failure,
            "strategies": _strategy_counts(outcome),
        }
    return summary


def summarize_dataset(
    players: Sequence[dict[str, Any]],
    outcomes: dict[str, ProviderOutcome],
    previous: Optional[dict[str, Any]] = None,
    complete_run: bool = True,
) -> dict[str, dict[str, Any]]:
    """
    La copertura del **dataset**, non della corsa.

    Distinzione che sembra pedante e non lo e': con il delta di esecuzione una
    corsa puo' toccare dieci giocatori, e `summarize()` direbbe onestamente
    "understat: 8". Ma quel numero finisce nel payload, e il gate di rilascio lo
    confronta con i 371 della volta prima: leggerebbe un crollo del 98% e
    bloccherebbe la pubblicazione di un dataset che invece e' intatto.

    Le coperture si contano quindi sui record finali — quelli appena costruiti e
    quelli ripresi, insieme.

    `strategies` e `failed` hanno lo stesso problema in forma piu' sottile.
    Descrivono la *corsa*, e in una corsa incrementale la corsa e' quasi vuota:
    il conteggio delle strategie si azzererebbe e `failed` tornerebbe a null,
    cambiando il contenuto del payload — e quindi l'hash, e quindi la versione —
    senza che un solo dato dei giocatori sia cambiato. E' esattamente il rumore
    che l'uscita `unchanged` del gate esiste per evitare.

    Quando la corsa non ha attraversato tutto il listone si riportano quindi
    quelli della volta prima, che e' anche la lettura vera: la provenienza dei
    record ripresi e' quella di allora, non quella di adesso.
    """
    total = len(players)
    previous_sources = previous or {}
    summary: dict[str, dict[str, Any]] = {}

    for name, outcome in outcomes.items():
        matched = sum(1 for p in players if (p.get("coverage") or {}).get(name))
        before = previous_sources.get(name) or {}

        if complete_run:
            failed = outcome.failure
            strategies = _strategy_counts(outcome)
        else:
            failed = before.get("failed")
            strategies = before.get("strategies") or {}

        summary[name] = {
            "matched": matched,
            "coverage": round(matched / total, 3) if total else 0.0,
            "unresolved": total - matched,
            "failed": failed,
            "strategies": strategies,
        }
    return summary


def _strategy_counts(outcome: ProviderOutcome) -> dict[str, int]:
    counts: dict[str, int] = {}
    for match in outcome.matches.values():
        counts[match.strategy] = counts.get(match.strategy, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def print_report(
    roster_size: int, outcomes: dict[str, ProviderOutcome], show_unresolved: int = 10
) -> None:
    print(f"\n{'=' * 62}\nCOPERTURA  ({roster_size} giocatori nel listone)\n{'=' * 62}")

    for name, stats in summarize(roster_size, outcomes).items():
        if stats["failed"]:
            print(f"\n  {name:<15} FONTE NON DISPONIBILE — {stats['failed']}")
            continue

        print(
            f"\n  {name:<15} {stats['matched']:>4}/{roster_size} "
            f"({stats['coverage'] * 100:.1f}%)  irrisolti: {stats['unresolved']}"
        )
        for strategy, count in stats["strategies"].items():
            print(f"      via {strategy:<24} {count}")

        unresolved: Sequence[RosterEntry] = outcomes[name].unresolved
        if unresolved and show_unresolved:
            sample = ", ".join(f"{e.name} ({e.team})" for e in unresolved[:show_unresolved])
            more = "" if len(unresolved) <= show_unresolved else f" … +{len(unresolved) - show_unresolved}"
            print(f"      non risolti: {sample}{more}")

    print(
        "\n  Gli irrisolti sono attesi per chi non ha giocato in Serie A la scorsa\n"
        "  stagione. Per gli altri, aggiungere una voce in dataset/manual_map.json.\n"
    )
