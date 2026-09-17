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
npm run build:portable # -> build/            the same, with no .glb files
npm run build:single   # -> dist/burnt-rubber.html   the whole game in one file
```

`npm run build` ships the manifest as **manifest.json** rather than
`manifest.webmanifest`, since many hosts reject that extension — the file is
plain JSON either way and only the `<link rel="manifest">` matters. It prints
every file type in the output so you can check it against a host's allowed
extensions before uploading. None of these need `npm install`; there are no
dependencies.

`npm run build:portable` is for hosts whose upload filter rejects `.glb`. Each
model ships as a `.js` file instead — a one-line script that assigns its bytes
(base64) into `window.__BR_MODELS__`, which is the same hand-off the
single-file bundle already uses, so the loader parses from memory rather than
fetching. The scripts are deferred and sit ahead of the module in `index.html`,
so they have run by the time the game asks for a model, and the service worker
precaches them in place of the `.glb` files. The output is then nothing but
`.html`, `.css`, `.js`, `.json`, `.jpg`, `.png` and `.svg`. Base64 costs about
a third on those files: 10.2 MB becomes 11.9 MB.

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
- **Team bets**: every outfit enters both its cars, and the Teams tab prices
  the pair as one — team win, team podium, double podium, both in the top
  half — from the same Monte Carlo the racer markets come from, with the
  team's palette as a swatch so the colours mean the same thing on the
  board and on the track.
- **Parlays**: legs from different races (any tours) multiply into one ticket.
- **In-race popup bets**: while spectating, live props about "your" racer pop
  up — *overtake the car ahead on this straight*, *reach P3 in the next 9s*,
  *hold position* — each with a button that cuts to the best camera to watch
  it land. On the loop tours your racer's pit stop is one too: *stop time
  over 2.5s?*, with an OVER and an UNDER button priced off the same stop
  distribution the stop is drawn from.
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
screen, and it lands *when* it played out: each popup carries the race-time
fraction at which the picture settles it — the moment the pit clock stops as
the car pulls away, the instant a "hold P4" loses the place, the frame a
surge completes — and the bet pays out there rather than at the flag, so
back-to-back in-race betting keeps moving. Bets that need the classification
(winner, podium, margin, fastest lap) still wait for the chequered flag. A
settled ticket stays on the live rail for a few seconds, marked WON or LOST,
instead of vanishing. The sponsorship bonus is funded by the one-time fee (of
which only 25% is recoverable), keeping the combined product near the global
RTP.

## The broadcast

A race is decided the moment betting opens; what stays alive is the
choreography. Gap curves with per-racer "drama harmonics" (inconsistent
racers swing harder) produce overtakes and swings all race while converging
exactly to the scripted finish.

**Pit stops.** The formula, stock and bike tours run four laps and every
car comes in once, through a lane that peels off the inside of the start
straight, at the end of lap one, two or three. The lane has two lines: cars
run down the fast lane, out toward the wall, and swing in to the box line
only around their own box, which is what lets one go past another that is
stopped. There is one box per team, in front of that team's garage and far
enough from the next that a car can pull into its own past the ones already
parked. The pit laps are dealt out per team: the teams are dealt round
the windows in a seeded order with a team's two cars on consecutive ones,
so the field is spread evenly and no garage ever has both its cars in the
lane at once. Each pit lap has its own reference profile — the virtual pace
car crawls through the lane on that lap at a speed that costs it exactly
the mean stop, and every profile is solved to cost the same time, so they
coincide again once the last lane is done and the scripted gaps mean the
same thing at the flag whatever lap a car chose. Each car then drives the
lane on its own kinematics (`PIT` in `src/engine/script.js`): arrives at
race pace, brakes hard on the entry ramp down to the lane limit, holds it
to its team's box, brakes to a standstill for a stop drawn log-normally
around the class median, launches back to the limit, holds it to the lane
end and pulls away up to pace over the next couple of hundred metres —
handing back to its gap curve at the speed that curve is running, so
there is no snap in position or speed at either end. Whatever its stop
cost against the mean it earns back gently: a share before the lane (never
more than a modest pace difference over the window it has) and the rest
faded out over the race after, so a car that pitted early simply sits
lower until the cars ahead take their turn. Standings are by distance, so a car sitting in its box loses
places to the field until they pit too. The complex (`src/three/pits.js`) is built from the track's own
frames: lane surface with the fast-lane line and box markings, a pit wall
with a stand on it, a garage per team with its header, sign and kit, and a
control centre behind each with window bands, a dish and masts. A crew per
garage is cast by the class — wheel gunners at every hub, tyre carriers
with the fresh rubber, a fuel man on the stock cars and bikes, and the
chief on the lollipop — from three rigged figures (`assets/fbx-src/crew/`,
Mixamo skeletons with a running clip, converted like the cars). They are
posed on their skeletons at runtime (`src/three/crewRig.js`): a pose is a
set of directions each bone should point along in the figure's own frame,
and every bone chases its target at its own rate, with breathing and sway
on top, so the crew settles into a crouch the way a person does; the run
clip is layered under it whenever a figure moves. The stop plays out in
full: out of the garage on the run, down on the guns (the gun walking
round the five lugs on a stock car, buzzing on a single nut on a formula
car), the old wheel sliding off and the new one on, the release with both
arms up, the wave, and the walk back with the old tyre; a fuel man holds
the can in the tank door on the garage side; the chief drops the board as
the car goes. Nobody walks through the car: a member whose way to the far
side would cross it is routed round an end — both ends of the walk are put
on the car's perimeter and the shorter way round gives the corners to aim
at — and anyone whose spot is on the lane side of the car waits level with
the nose until it is in, rather than standing where it is about to be. Each
crew member wears the number of the car they are serving on a badge on
the chest (the rigs' atlases split the chest across islands, so it is a
decal rather than an atlas overlay), and the crew serves the team's stops
in order, so a double-stack hands over without a teleport. Your racer's stop is a cutscene: the camera goes to a shot list
(the lane mouth from the wall, a low chase down the lane, the garage's own
view as the car brakes in, a slow orbit over the box, a wheel close-up
through the launch, a pan from the wall, the exit) with a stopwatch on the
screen against the line, and hands back to the camera you were on; pick a
camera chip during it to skip.

**Pacing.** Every gap is measured against a virtual pace car with a
per-class profile — launch acceleration and cruising speed
(`PACE` in `src/engine/script.js`): formula cars launch hard and run fast,
stock cars wind up slowly to a high speed, rally cars and bikes sit in the
middle (bikes launch hard), trophy trucks lumber. The base race distance is
wherever the pace car gets to in 40 seconds, so the lap length follows from
the profile; each tour then scales that distance (`distScale` in
`src/data/tours.js`: the formula tour runs four laps of a 1.2 km
grand-prix layout, the stock cars four of a 1 km oval, a quarter more stage
on rally and baja) and the leader's time follows from the distance, about
75 to 85 seconds on the loop tours with a pit stop each, 50 to 55 on a
stage. The race window is sized so a 40-truck field's tail is home before
the results. Gaps are kept in seconds but drawn in metres: on
the grid a second is one row pitch, at cruise it is a cruise-speed's worth of
road, so the whole field launches together from its real slots and stretches
out as the speed builds. Every surge or fade (holeshot enforcement, popup
choreography) is rate-limited — a bump that would be too steep starts
earlier and fades later — so a charging car never exceeds about one and a
half times the pace and nobody ever runs backwards. Drama only switches on
once the field is up to speed.

**Solid cars.** Nothing is ever drawn inside another car. The lateral pass
eases cars apart across the road; where it has run out of road — a narrow
stage with forty trucks on it, a pack three abreast — a bounded relaxation
along the road makes the room instead, the car behind easing off and the one
ahead pulling away, half each, at no more than a hard lift-off and never
backwards. A car is never drawn more than a few lengths from where its
script puts it, and that slack closes to nothing by the flag. Cars in the
pit lane get the same treatment in the lane's own frame, where a car stopped
in its box is the fixed point everything else works around. All of it moves
only what is drawn: the scripted distances, and with them the race, are
untouched. Two things feed it: in traffic a car holds its line instead of
sweeping across to the racing line, and the drama harmonics scale with the
field, because a swing that reads as a scrap in a ten-car race would have
forty trucks eight metres apart passing through each other.

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

**Liveries, palettes and numbers.** Every team has a three-colour palette
(`teamPalette` in `src/data/names.js`): a primary and secondary accent and
a base bodywork colour, generated so every team in a bank is distinct —
hues step round the wheel by the golden angle, bases cycle a curated set
(pearl, jet, silver, navy, cream, gunmetal, oxblood, racing green, gold…),
and the secondary is a complement or a neutral chosen for contrast against
the base. Each palette carries a name (`racer.palette`, e.g. "Navy Teal")
for the UI. The livery shader remaps the atlas's two accent hues to the
primary and secondary as before, and now also repaints the atlas's white
bodywork in the base colour, keeping the baked shading, so the whole field
reads as different teams rather than one white car in accent trims. The
racing numbers on the bodywork are the drivers' own: `src/three/numbers.js`
lists where each atlas has a number baked in (rectangles and how the glyph
is turned there) and draws a small per-car overlay — a plate tile per
rectangle with the driver's number in the same orientation — that the
shader paints over the atlas; 128 px per plate instead of a per-car
atlas. The formula car, which has no baked number, carries decals seated
on the nose and both sidepods by raycast.

**Trackside and scenery.** `src/three/trackside.js` builds the grandstands
as one stepped concrete tier (an extruded profile) with seat strips, an
advertising board, a back wall and a roof on columns, and fills them with a
crowd: one InstancedMesh per stand of low-poly figures, coloured per
instance and animated entirely in the vertex shader (a per-instance phase
drives a bounce and an arm sway), so a thousand spectators are one draw
call and no CPU work. The gantry over the line carries a dot-matrix LED
screen (a canvas texture: text drawn small, read back and lit as dots,
with a chasing border) that says START on the grid, the current lap, and
FINISH on the last lap; a stage's start and finish gantries say START and
FINISH. `src/three/flora.js` is the species library — spruce and fir with
ruffled, drooping tiers for the rows of branches, oak and birch as clusters
of deformed lobes, two bushes, desert scrub, a ribbed bulb cactus with
L-shaped arms, a palm, stumps, logs, rocks, hay bales, fences, mountain
peaks and street furniture — each one merged geometry with vertex colours,
drawn instanced. `src/three/dressing.js` scatters them per environment
around the loop circuits (forest, plains, coast, desert, tundra, mountain)
and builds the city: textured facades with a window pitch, ground-floor
bands, parapets, setback towers and roof plant, with streetlights, traffic
lights, hydrants, mailboxes, benches, bollards and bins along the kerbs.
The stages use the same species on their terrain.

**Circuits.** The formula and bike layouts are grand-prix style rings
(`GP` in `src/three/trackGen.js`): control points at uneven angles with
radius swings for sweepers and esses, one or two pulled hard inward for
hairpins, an esses complex, and runs of points set on a line for real
straights — all radial so the lap never crosses itself, then relaxed at
the tightest corner only until nothing is tighter than the road can take.
The bike's layout is a step calmer than the formula car's, on a 1 km lap. Start and finish strips are laid on the
road surface itself, so they sit flush on crests, dips and banking.

**Stages.** Rally and Baja are point-to-point, not loops: the start and
the flying finish are kilometres apart, with a grid straight before the
line and run-off after it. `src/three/trackGen.js` walks the route as a
chain of zones — a rally alternates tight forest (quick cuts, a narrow
lane) with mountain ridges (contour sweeps along a hillside); a baja runs
through dunes, plains, mesas and canyons — with each zone's own bend
sharpness and straight lengths, kept clear of its own earlier legs and
steered so it never doubles back. `src/three/terrain.js` then builds the
land: a heightfield whose zone character is a distance-weighted average
over the whole route (so it never seams between two legs) and settles into
mountains or mesa country far off; the road's profile is that relief
low-passed and grade-limited, and the terrain blends to it over a shoulder
so the road reads as cut and filled into the hillside. Instanced pines,
rocks, cacti and scrub dress it by zone. Everything that assumed a lap —
grid placement, corner look-ahead, the cinematic corner chain, collisions
in track space, the lap counters — goes through the track's own
distance-to-curve mapping, so loops and stages share one scene.

**Surfaces.** `src/three/effects.js` puts what the cars leave on the road
and throw up behind them into two draw calls. Tyre marks are quads laid
from each rear wheel's contact point into a ring-buffered mesh: rally cars
and trophy trucks rut shallow tracks the whole way and deeper ones under
braking, heavy cornering or a slide (darker when wet); tarmac classes only
leave black rubber from a locked-up braking stab. The ring holds a whole
race for the biggest dirt field, and if it ever wraps a mark fades out as
the head approaches its slot instead of vanishing when overwritten (the
dirt laps are short enough that a smaller ring was recycling ruts in
patches right in front of the pack). Particles are point
sprites with a per-particle world size and fade: dust plumes on dry dirt
and sand, mud or wet sand clods on a ballistic arc when wet, the odd fleck
of gravel off the stock car's oval, a wisp of tyre smoke off a lock-up on
tarmac. Big fields throw up less each so the cloud stays within budget.

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
src/three/                  procedural tracks, pits and crews, car models, scene, cameras
assets/models/              game-ready GLBs; assets/fbx-src/ the sources
tools/                      build, single-file bundle, FBX -> GLB pipeline
src/ui/                     hub, bet board, live HUD, garage, bet slip, portraits
sw.js, manifest.webmanifest PWA packaging (fully offline-capable)
```

All credits are fictional play money; the bankroll refills itself when empty.
