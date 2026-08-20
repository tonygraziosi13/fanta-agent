"""
Gate di rilascio del dataset (US19-T3).

Sta fra la generazione e il commit, e risponde a una domanda sola: *questo
dataset merita di sostituire quello gia' online?*

Serve perche' l'automazione toglie l'unico controllo che il rilascio manuale
aveva, cioe' qualcuno che legge il report prima di committare. Due modi in cui
un rilascio automatico senza gate andrebbe storto in silenzio:

  - `build_dataset.py` ritorna 0 anche se **tutte** le fonti falliscono. E'
    giusto cosi' in locale (un dataset con una copertura in meno vale piu' di
    nessun dataset), ma a valle di un commit automatico significherebbe
    pubblicare un file a copertura zero sopra uno buono. Gli IP dei runner CI
    sono datacenter, e una fonte che ci rifiuta e' uno scenario concreto:
    FBref lo fa gia' da una macchina domestica, quando Cloudflare decide che
    non siamo un browser.

  - `generated_at` e' escluso dall'hash (`export.py:_canonical`) ma finisce nei
    file. A fonti immutate l'hash e' identico e i byte no: un `git diff` come
    criterio di pubblicazione committerebbe rumore a ogni esecuzione.

Da qui le tre uscite: `unchanged` guarda l'hash, `regression` guarda il blocco
`sources` del payload, `publish` e' il resto. Nessuna guarda i file su disco.

Modulo puro: stdlib, niente rete, niente git, niente GitHub. La decisione si
prova in unittest (`tests/test_release.py`) senza far girare un workflow.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from . import config

PUBLISH = "publish"
UNCHANGED = "unchanged"
REGRESSION = "regression"


@dataclass
class SourceDelta:
    """Come si e' mossa una fonte fra il dataset online e quello appena generato."""

    name: str
    before: int
    after: int
    regressed: bool = False
    note: str = ""


@dataclass
class Decision:
    action: str
    version: str
    players: int
    previous_version: Optional[str] = None
    previous_players: Optional[int] = None
    deltas: list[SourceDelta] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)

    @property
    def should_publish(self) -> bool:
        return self.action == PUBLISH

    @property
    def is_failure(self) -> bool:
        """Solo la regressione e' un errore. `unchanged` e' un esito normale."""
        return self.action == REGRESSION


def _sources(payload: Optional[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if not payload:
        return {}
    raw = payload.get("sources")
    return raw if isinstance(raw, dict) else {}


def _matched(entry: dict[str, Any]) -> int:
    value = entry.get("matched")
    return value if isinstance(value, int) else 0


def _failed(entry: dict[str, Any]) -> Optional[str]:
    value = entry.get("failed")
    return value if isinstance(value, str) and value else None


def compare_sources(
    old_payload: Optional[dict[str, Any]],
    new_payload: dict[str, Any],
    min_ratio: float = config.RELEASE_MIN_COVERAGE_RATIO,
) -> list[SourceDelta]:
    """
    Confronto fonte per fonte, con la **baseline reale** come metro e non un
    ideale: una fonte che fallisce da sempre — FBref quando Cloudflare ci
    respinge — chiamata regressione a ogni esecuzione renderebbe il gate un
    allarme che nessuno guarda piu'. E' anche cio' che permette di *togliere*
    una fonte ormai inutile senza bloccare il primo rilascio successivo.
    """
    before_all = _sources(old_payload)
    after_all = _sources(new_payload)
    deltas: list[SourceDelta] = []

    for name in sorted(set(before_all) | set(after_all)):
        before_entry = before_all.get(name, {})
        after_entry = after_all.get(name)
        before = _matched(before_entry)

        # Fonte nuova, o gia' rotta prima: non c'e' niente da perdere.
        if name not in before_all or before == 0 or _failed(before_entry):
            deltas.append(
                SourceDelta(name=name, before=before, after=_matched(after_entry or {}))
            )
            continue

        if after_entry is None:
            deltas.append(SourceDelta(name, before, 0, True, "sparita dal payload"))
            continue

        failure = _failed(after_entry)
        if failure:
            deltas.append(SourceDelta(name, before, 0, True, f"fonte caduta: {failure}"))
            continue

        after = _matched(after_entry)
        if after < before * min_ratio:
            deltas.append(
                SourceDelta(
                    name,
                    before,
                    after,
                    True,
                    f"copertura crollata sotto il {min_ratio:.0%} della precedente",
                )
            )
            continue

        deltas.append(SourceDelta(name, before, after))

    return deltas


def decide(
    new_manifest: dict[str, Any],
    new_payload: dict[str, Any],
    old_manifest: Optional[dict[str, Any]] = None,
    old_payload: Optional[dict[str, Any]] = None,
    min_ratio: float = config.RELEASE_MIN_COVERAGE_RATIO,
) -> Decision:
    version = str(new_manifest.get("version", "?"))
    players = int(new_manifest.get("players_count") or 0)
    previous_version = str(old_manifest["version"]) if old_manifest else None
    previous_players = int(old_manifest["players_count"]) if old_manifest else None

    decision = Decision(
        action=PUBLISH,
        version=version,
        players=players,
        previous_version=previous_version,
        previous_players=previous_players,
    )

    # Prima esecuzione: non c'e' baseline con cui poter regredire.
    if not old_manifest:
        decision.reasons.append("Nessun dataset precedente: primo rilascio.")
        return decision

    # L'hash e' sul contenuto: uguale significa che nulla e' cambiato alle
    # fonti, e ripubblicare cambierebbe solo `generated_at`.
    if new_manifest.get("hash") and new_manifest.get("hash") == old_manifest.get("hash"):
        decision.action = UNCHANGED
        decision.deltas = compare_sources(old_payload, new_payload, min_ratio)
        decision.reasons.append(
            f"Contenuto identico alla versione {previous_version}: niente da pubblicare."
        )
        return decision

    decision.deltas = compare_sources(old_payload, new_payload, min_ratio)
    regressed = [d for d in decision.deltas if d.regressed]

    # Il listone e' l'anagrafica di riferimento: se si dimezza non e' una fonte
    # esterna ad essere caduta, e' la generazione ad essere rotta.
    if previous_players and players < previous_players * min_ratio:
        decision.action = REGRESSION
        decision.reasons.append(
            f"Il listone e' passato da {previous_players} a {players} giocatori."
        )

    if regressed:
        decision.action = REGRESSION
        for delta in regressed:
            decision.reasons.append(
                f"{delta.name}: {delta.before} -> {delta.after} ({delta.note})"
            )

    if decision.action == PUBLISH:
        decision.reasons.append(
            f"Nuova versione {version} ({players} giocatori), nessuna fonte in regressione."
        )

    return decision


def render(decision: Decision) -> str:
    """Riassunto leggibile: lo stesso testo va sul terminale e nello step summary."""
    titles = {
        PUBLISH: "PUBBLICO",
        UNCHANGED: "NIENTE DA PUBBLICARE",
        REGRESSION: "RILASCIO BLOCCATO",
    }
    lines = [f"{titles.get(decision.action, decision.action)} - versione {decision.version}"]

    if decision.previous_version:
        lines.append(
            f"precedente: {decision.previous_version} "
            f"({decision.previous_players} giocatori) -> {decision.players} giocatori"
        )

    if decision.deltas:
        lines.append("")
        lines.append("copertura per fonte (prima -> dopo):")
        for delta in decision.deltas:
            mark = "!!" if delta.regressed else "  "
            note = f"  - {delta.note}" if delta.note else ""
            lines.append(
                f"  {mark} {delta.name:<15} {delta.before:>4} -> {delta.after:<4}{note}"
            )

    if decision.reasons:
        lines.append("")
        lines.extend(f"  {reason}" for reason in decision.reasons)

    return "\n".join(lines)
