"""
Pipeline di generazione del dataset arricchito (US19).

Aggrega quotazioni ufficiali, rendimento storico, metriche avanzate e storico
infortuni in un unico JSON versionato, consumato dall'app via HTTP (US20).

Il principio che tiene insieme il package: *il listone e' la fonte di verita'
dell'anagrafica*. Le fonti esterne si agganciano ai giocatori del listone, mai
il contrario. Chi e' appena arrivato in Serie A resta nel dataset con metriche
`null` e un flag di copertura a false: e' un dato mancante dichiarato, non uno
zero inventato.
"""
