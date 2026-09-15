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

## Building it to host elsewhere

```sh
npm run build          # -> build/            an uploadable copy of the site
npm run build:single   # -> dist/burnt-rubber.html   the whole game in one file
```

`npm run build` ships the manifest as **manifest.json** rather than
`manifest.webmanifest`, since many hosts reject that extension — the file is
plain JSON either way and only the `<link rel="manifest">` matters. It prints
every file type in the output so you can check it against a host's allowed
extensions before uploading. Neither command needs `npm install`; there are no
dependencies.

`build:single` inlines three.js and every module into one `.html` file with no
other requests at all — the fallback when a host only accepts a single page or
a short list of extensions. It drops the service worker and manifest, so it is
not installable as a PWA and does not work offline.

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
- **Hub**: the five tours sit along the bottom of the hub, each with its
  status and its BET BOARD / WATCH LIVE / RESULTS button always showing;
  hovering a tab slides it up to reveal the top of its leaderboard with win
  odds — projected from the market before the start, live standings during
  the race, the result after.
- **Bet tracker**: a hub-screen rail with every open ticket's live progress
  (current position, grid countdown, in-play props) and recent results —
  tap a ticket to jump to its race.

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
exactly to the scripted finish.

**Pacing.** Every gap is measured against a virtual pace car with a
per-class profile — launch acceleration and cruising speed
(`PACE` in `src/engine/script.js`): formula cars launch hard and run fast,
stock cars wind up slowly to a high speed, rally cars and bikes sit in the
middle (bikes launch hard), trophy trucks lumber. The race distance is
wherever the pace car gets to in the leader's 40 seconds, so the lap length
follows from the profile. Gaps are kept in seconds but drawn in metres: on
the grid a second is one row pitch, at cruise it is a cruise-speed's worth of
road, so the whole field launches together from its real slots and stretches
out as the speed builds. Every surge or fade (holeshot enforcement, popup
choreography) is rate-limited — a bump that would be too steep starts
earlier and fades later — so a charging car never exceeds about one and a
half times the pace and nobody ever runs backwards. Drama only switches on
once the field is up to speed.

**Steering.** A car's position across the road is not set, it is driven:
sideways speed is a slip angle on the forward speed (a car on the grid
cannot slide across), it builds and bleeds at a bounded lateral
acceleration, and the car is pointed where it is actually going. So the
drawn path from the grid slot onward is one a car could drive — the racing
line, the separation nudges and the queue-up behind a slower car all go
through the same steering step. Corners are never tighter than the road
can take (the track generator relaxes any bend whose centreline radius
would fall under half the width plus a margin).

Five cameras:

- **3rd person** behind any car
- **Driver's view**: the driver's eyes, in the car's own frame, so it rolls
  with the body and leans with the bike. The models are exteriors only, so
  each class carries a procedural cockpit kit (`src/three/cockpit.js`) —
  cabin shell, dashboard with dials, steering wheel that turns with the
  road, pillars, and the class's own furniture (halo, roll cage) — attached
  to whichever car the camera is riding; a bike hides its rider and looks
  over the bars through its screen. Every car carries a driver (the rider
  figure in a second, seated pose from the same pipeline), head on the
  camera's eye point so the onboard view looks out of the helmet with the
  arms on the wheel — the arms are exported as jointed upper arms and
  forearms and aimed at grips on the rim by two-bone IK, riding the wheel
  as it turns and re-gripping hand over hand in hard corners — and the
  glazing is tinted rather than opaque so the driver shows through it from
  outside
- **Hood-back**: a reverse angle — a boom out ahead of the nose, above hood
  height, looking back over the car at whoever is chasing it
- **Cinematic**: trackside cameras auto-placed at the highest-curvature
  corners, cutting sequentially as the pack arrives and panning with the
  leaders like broadcast action cams
- **Chopper**: aerial follow that climbs as the field spreads out so the
  whole race stays in frame

Every car carries a label — number, flag and name — with a separate position
badge beside it that follows the leaderboard; the car being ridden onboard
hides its own. Tap any car in view — its body or its label — to follow it:
the onboard views keep their view and change the driver, the cinematic and
chopper cameras cut to 3rd person on it. (A drag is not a tap, so orbiting
the view never changes the car.) When that car crosses the line, a finish card names the racer,
their race time, gap to the winner and finishing position, while the camera
bar stays live underneath so you can keep switching cars and views until the
full results come up.

### The cars

Each tour's vehicle is a real model (`assets/models/*.glb`), built from the
textured FBX sources in `assets/fbx-src/` by `npm run models` (a dev-time
tool: it needs a static server on the repo root and playwright-core with
Chromium). The sources are single merged meshes, so the pipeline recovers
parts from geometry: it welds the mesh, splits it into
connected shells, and classifies each by shape and placement — wheels are
round and low, wings are thin plates, glazing sits high, tiny bits are trim.
Wheels become their own nodes pivoted at the axle so they spin; on the bike
the paddock stand (everything reaching the ground behind the rear axle) is
its own node hinged at the axle; the rest is grouped into `primary` and
`secondary` bodywork (the team livery), `glass`, and `dark`. Every car on track shares the geometry and only carries its two
livery materials. Paint is physically based with a baked studio reflection,
each car casts a soft contact shadow, and the bike gets a rider.

**The rider and driver.** `assets/fbx-src/rider_tex.fbx` is a static A-pose
figure. The pipeline poses it in code, twice — a racing tuck for the bikes
and a seated driver for the cars — — the mesh is split by height and width into legs,
arms, torso and head, and each limb is bent about its joint (knees to the
pegs, elbows to the grips, torso onto the tank, helmet pitched up to the
road) — then exports it as `rider.glb` with the hips at the origin. At
runtime `placeRider` seats one on every bike; its suit and helmet use the
same livery-remap shader as the bodywork, so it carries the team colours.

**Liveries.** Every car is textured with its vehicle's painted PBR atlas
(`assets/liveries/`: base colour and normal at 1024², roughness and
metalness packed into one 512² map), baked by `npm run models` from the
textures embedded in the FBX sources. Each team still gets its own palette:
the shader finds the atlas's two accent hues — weighted by how much of the
car's actual surface they cover — and remaps pixels near them to the team's
primary and secondary colours, keeping the baked shading, decals, numbers,
whites and blacks exactly as painted. A model without UVs would keep the
flat role paint instead.

**Body dynamics.** Each class sits on its own suspension (`BODY` in
`src/three/scene.js`): the body rolls outward under cornering load and
pitches under power and braking through a damped spring — stiff and
critically damped on the formula car, looser on the stock car, bouncy on
the rally car and trophy truck. On loose surfaces the nose turns into the
corner beyond the path (a drift); on tarmac it leads with the nose. Over
gravel each wheel works its own bumps from a smooth noise — slow and big at
a crawl, fast and small at speed — while the body rides level above them.
Wheels spin with the road, capped at what a frame rate can show. Bikes lean
into the load up to a knee-down angle, the rider hangs off the inside from
the hips, and the paddock stand (its own hinged node in the model) swings up
off the rear wheel as the race goes green. Orientation always comes from an
explicit forward/up basis, never a minimal rotation, which is what used to
flip cars over where a road dipped.

**Moving parts.** Front wheels steer into the road ahead and whatever the
car is steering across, straightening as the tail comes round in a drift.
Rally cars and trophy trucks carry brake lights that come on under
deceleration and into sharp bends; the formula car has a single rain light
that flashes only in the wet, and the bike one that stays on in the wet
(a share of races run wet — a grey, close day — drawn per race from the
seed). The formula car's rear-wing flap is its own hinged node from the
model pipeline and swings open on hydraulics above 90% of cruise speed
(DRS), shutting again below it. In the driver's view the instruments are
live: needles follow speed and revs, the gear steps with speed, the lap
and fuel count down, warning lamps light for braking, rain and low fuel,
and the formula wheel's shift lights fill with the revs and show DRS.

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
src/three/                  procedural tracks, car models, scene, cameras
assets/models/              game-ready GLBs; assets/fbx-src/ the sources
tools/                      build, single-file bundle, FBX -> GLB pipeline
src/ui/                     hub, bet board, live HUD, garage, bet slip, portraits
sw.js, manifest.webmanifest PWA packaging (fully offline-capable)
```

All credits are fictional play money; the bankroll refills itself when empty.
