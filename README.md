# REALMS — The Sundered Shelf

A third-person fantasy action RPG that runs in a browser tab. No plugins, no
downloads, no binary assets: the entire world — terrain, sky, water, trees,
architecture, characters, music and sound — is generated in code at load.

You are the Warden: bald, in dark plate with aether running through the seams,
with a wolf that has the same light in it. The Keep has not answered its beacons
in nine years. It is about twelve hundred metres north, across a valley, and you
can see it from where you are standing.

```bash
npm install
npm run dev
# http://127.0.0.1:43141
```

Click once to begin (the browser needs a gesture before it will make a sound).

---

## The world

The Sundered Shelf is a floating continent. Its rivers do not reach a sea; they
pour off the rim and fall until the cloud deck swallows them. That single idea
does a lot of work: it gives every edge of the map a reason to be a cliff
instead of an invisible wall, it puts a horizon under your feet as well as above
your head, and it means there is always something dramatic in frame.

| | |
|---|---|
| **The Watcher's Cliff** | where you start, looking north |
| **Emberpine Wood** | the trees here burn slowly, all year |
| **Amberfell** | the last village on the shelf |
| **Mirrowmere** | a lake that remembers the sky |
| **The Sunken Colonnade** | older than the Keep, older than the fall |
| **The Great Fall** | the river leaves the world here |
| **The Riftspan** | one arch, and a very long drop |
| **The Skyshards** | stones that refused to fall |
| **The Warden's Gate** | sealed with three sealstones |
| **Skyfall Keep** | and whatever is still sitting on the throne |

## Controls

| | |
|---|---|
| **WASD** | move |
| **Shift** | sprint |
| **Space** | jump |
| **C / Ctrl** | dodge roll (invulnerable through the roll) |
| **Left click** | attack — three-hit combo, buffered |
| **Right click** | heavy attack |
| **F / E** | interact |
| **Q** | lock on |
| **1 / 2 / 3** | Aether Surge · Riftstep · Ashfang's Fury |
| **Tab** | journal · **M** map · **Esc** pause |
| **Mouse** | look (click-drag also works without pointer lock) |

Gamepads and touch are supported; on a phone the left half of the screen is a
virtual stick and the right half looks.

## What you can do

Walk, sprint, jump, dodge, attack, use three abilities, fight packs of husks and
stalkers and riftwisps, take a quest from Elder Maren, thin out the wood, find
three scattered sealstones, open the Warden's Gate, and put down the Warden of
the Fall across three phases. Shrines are checkpoints — light one and you wake
there. Discovering a place gives XP; so does reading the inscriptions.

---

## How it is built

Next.js hosts a single client component; everything below that is plain
TypeScript over three.js with hand-written GLSL. There is no ECS and no game
framework — the systems are small enough to name.

### Rendering

The scene renders linear into a half-float buffer and stays HDR all the way to
the final pass, so the sun disc (drawn at ~13.0) blooms like light rather than
clipping to white. Post chain: light shafts (radial occlusion blur toward the
sun) → bloom → one grade pass doing ACES, lift/gamma/gain, chromatic
aberration, grain, vignette, the cinematic letterbox and the fade.

Every lit material in the world runs the same **atmosphere**: exponential height
fog, analytically integrated along the view ray and tinted toward the sun, so
distant ridges glow where they face the light. One uniform block is shared by
reference across every material — one write per frame moves the whole world's
air.

A stylised **rim light** on characters and masonry keeps them readable when
backlit, which they usually are. Physically that frame is a black silhouette;
this is the lie that makes it legible.

### Terrain

One analytic height function defines the shelf: domain-warped ridged
multifractal for the mountains, a lake basin, two carved rivers, a rift, authored
building pads, and a plunging rim. The renderer tessellates it as a 14×14 grid
of chunks at four densities, chosen per frame from camera distance and built
lazily under a strict per-frame budget so walking never hitches. Vertex normals
come from the height function rather than from the triangles, so chunks at
different LODs shade identically and the seams cannot crack; a short skirt hides
the geometric gap.

A 512×512 **world-data map** is baked at load and carries four channels the
shader would otherwise recompute per pixel: the road network, multi-scale
ambient occlusion, moisture, and region identity. Baking it is what lets the
shelf read as an authored place rather than as noise.

The **King's Road** is graded at load — sampled along its splines, smoothed, then
slope-clamped in both directions — and then cut into the terrain inside a
feathered corridor. A world you cannot walk across is a diorama, so the route
from the Watcher's Cliff to Skyfall Keep is guaranteed climbable no matter how
the noise shifts under it.

### Vegetation

Trees are three species × three prototypes, seeded and bucketed into a spatial
grid of `InstancedMesh`es so frustum culling actually removes geometry (one big
instanced mesh is always "visible"). Bark and alpha-tested canopy ride in a
single instanced draw as two material groups, with per-instance tint and sway
phase so no two trees are the same colour or move in sync. ~14,000 trees.

Grass is one draw call: a ring buffer of tiles that follows the player, where
only the handful of tiles that changed get rewritten when you cross a boundary.
Clumps collapse toward their base near the camera and past the far cutoff.

### Characters

There are no imported models and no animation clips. Characters are skinned
meshes built from swept tubes and extruded plates, skinned automatically from
distance to bone segments, and driven by a hand-written clip set: idle, walk,
run, sprint, strafe, jump, fall, land, roll, three attacks, cast, hurt, death.
Each clip is a function of phase writing weighted euler offsets into a pose
accumulator; the animator cross-fades, then additive layers (look-at, torso
twist, hit lean, a velocity-driven cloak) and two-bone foot IK run on top.

Because clips are functions of phase, combat reads damage windows directly out
of the animation — what you see is what hits.

The wolf is the same system with a five-bone spine, a four-bone tail, and gaits
written as phase functions: a diagonal trot and a rotary gallop, both advanced
by distance travelled so the paws never skate.

### Game systems

- **Controller** — coyote time, buffered jump and attack, a three-hit combo with
  root motion and cancel windows, an i-frame roll, asymmetric gravity.
- **Camera** — a spring arm with terrain- and prop-aware collision, lag that
  scales with speed, FOV that widens with sprint, roll into strafes, decaying
  impact shake, and lock-on reframing.
- **Collision** — not a rigid-body engine. Analytic ground height, capsule
  push-out, and walkable platforms above the terrain (the Riftspan, the keep
  floors, the floating islands), all in a uniform grid.
- **AI** — grunts share an attacker budget, so a pack surrounds you instead of
  all swinging at once. The Warden has three phases, telegraphed heavies, a
  charge, a delayed second shockwave, and a summon.
- **Audio** — no audio files. Wind, water, footsteps, combat and a generative
  score (52 bpm, D minor, a four-note horn motif that only states itself when
  the world is calm) are all synthesised through Web Audio, and the arrangement
  responds continuously to how much trouble you are in.

### Performance

Instancing everywhere, spatial bucketing so culling works, lazy LOD under a
frame budget, one draw call for grass, structures merged per material, an
adaptive quality governor that moves render scale, shadow resolution and
post-processing cost from a rolling FPS estimate, and particles pooled into two
instanced draws (one additive, one alpha).

---

## Dropping in your own art

The procedural content is a default, not a constraint. Put a manifest at
`public/models/manifest.json` and the game will prefer your GLBs wherever an id
matches, falling back to the procedural version for anything you have not
replaced. An imported character adopted through `Rig.adopt` inherits the whole
animation set, combat timing, foot IK and weapon sockets, because all of that is
driven by canonical bone names rather than by imported clips.

See **[`public/models/README.md`](public/models/README.md)** for the manifest
schema, the bone contract, and Blender export settings.

## Developer URLs

| | |
|---|---|
| `?q=low\|medium\|high\|ultra` | pin the quality preset |
| `?skipintro` | straight into play |
| `?intro=8.5` | start the opening partway through |
| `?at=x,z&yaw=3.14` | drop the player somewhere |
| `?inspect=warrior\|wolf\|tree` | model turntable (`&spin`, `&flat`, `&clip=run`) |
| `?tdbg=1\|2\|3` | terrain albedo / world normal / baked AO |
| `?debug` | FPS and coordinates |

## Stack

Next.js · React (HUD only) · three.js · custom GLSL · Web Audio · zustand
