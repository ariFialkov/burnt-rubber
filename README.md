# 🏁 Burnt Rubber

A 3D racing sportsbook you can install as a PWA and play on desktop or mobile.
Five fictional tours run endless live races around the clock; you bet play-money
credits on outcomes, then watch your ticket play out through broadcast cameras.

**Pure chance, dressed as a sportsbook.** There is no skill anywhere in the
game: every market is priced from the same probability model that decides the
outcome, with the house margin set by a global RTP. The "stats", "form", and
odds landscape exist to make the market interesting — not to be solved.

## Play it

- **Hosted build** — https://claude.ai/code/artifact/d7b29689-5a60-4ed5-a8c6-1b155cffdcfc
  (a single self-contained page built by `node tools/bundle.mjs`)
- **GitHub Pages** — https://arifialkov.github.io/burnt-rubber/
  (`.github/workflows/pages.yml` redeploys it on every push to this branch)

## Running it locally

It's a fully static site — no build step, no dependencies to install
(three.js is vendored). Serve the repo root over HTTP:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Install it from the browser (Add to Home Screen / Install App); the service
worker caches everything, and because the world runs off the wall clock and a
deterministic seed, it works fully offline.

## The world

| Tour | Vehicles | Racers/race | Bank |
|---|---|---|---|
| Nebula 1 | open-wheel | 10 | 40 racers |
| FASTCAR | stock cars (ovals) | 18 | 72 racers |
| Rally Champs | rally cars | 26 | 104 racers |
| The Desert Tour | baja trucks | 40 | 160 racers |
| Moto3T | bikes | 11 | 44 racers |

Each tour cycles endlessly: **72s betting → 48s race → 15s cooldown**,
staggered so a race goes green somewhere every ~27 seconds. Tracks rotate
through a bank of real locations with made-up event names (Spanish Cup ·
Madrid, Rally Zanzibar, Death Valley Classic, …). Fields, form, odds and
purses reshuffle every race.

Everything — schedules, fields, odds, finish orders, in-race drama — derives
from seeded RNG over the wall clock, so every player on earth sees the *same*
live races at the same moment, with no server.

## Betting

- **Pre-race**: winner, podium, top-N, top-half, head-to-heads, holeshot
  (leads lap 1), fastest lap, winning-margin over/under.
- **Parlays**: legs from different races (any tours) multiply into one ticket.
- **In-race popup bets**: while spectating, live props about "your" racer pop
  up — *overtake the car ahead on this straight*, *reach P3 in the next 9s*,
  *hold position* — each with a button that cuts to the best camera to watch
  it land.
- **Sponsorship (Garage)**: pay a one-time fee to own a racer; winning WIN
  bets on them pay +25% winnings. Sell back anytime for 25% of the fee.

### The RTP story

Global RTP is **0.92**: an outcome with true model probability `p` pays
`0.92 / p`. Outcomes are *drawn from the same model* the prices came from —
including scripted facts (holeshot, fastest lap, margin) and popup props,
whose outcomes are drawn at their priced probability and then choreographed
into the race. Settlement of popup bets is whatever actually played out on
screen. The sponsorship bonus is funded by the one-time fee (of which only
25% is recoverable), keeping the combined product near the global RTP.

## The broadcast

A race is decided the moment betting opens; what stays alive is the
choreography. Gap curves with per-racer "drama harmonics" (inconsistent
racers swing harder) produce overtakes and swings all race while converging
exactly to the scripted finish. Five cameras:

- **3rd person** behind any car, **driver's view**, **hood-back**
- **Cinematic**: trackside cameras auto-placed at the highest-curvature
  corners, cutting sequentially as the pack arrives and panning with the
  leaders like broadcast action cams
- **Chopper**: aerial follow that climbs as the field spreads out so the
  whole race stays in frame

Cars don't pass through each other: each carries a collision footprint and a
separation pass keeps the field apart. It works in track space (offset along
the track vs. across it) rather than 3D, so it stays cheap even with 40 Baja
trucks — about 0.2 ms a frame. Racers hold their own line and ease aside with
a look-ahead measured in time-to-contact, so a fast closer starts moving early
instead of snapping; when the track is full across, the trailing car tucks in
behind rather than driving through. All of it is presentation only — it moves
where a car is *drawn*, never its distance along the track, so standings, gaps
and the scripted finish are untouched.

## Code map

```
index.html, styles.css      app shell + HUD/menus
src/core/rng.js             seeded RNG (everything derives from this)
src/data/                   tours, track banks, procedural racer banks
src/engine/schedule.js      the world clock: endless staggered race cycles
src/engine/odds.js          RTP pricing (Plackett–Luce + seeded Monte Carlo)
src/engine/script.js        race scripts: outcomes, drama curves, popup director
src/engine/bets.js          wallet, slip, sponsorships, deterministic settlement
src/three/                  procedural tracks, low-poly cars, scene, cameras
src/ui/                     hub, bet board, live HUD, garage, bet slip, portraits
sw.js, manifest.webmanifest PWA packaging (fully offline-capable)
```

All credits are fictional play money; the bankroll refills itself when empty.
