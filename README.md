# Aetherwake

A playable vertical slice of a 3D fantasy sandbox RPG. The Vale is still singing. Almost everything interesting in it — birds, stone, lightning, fungus, bosses, materials — can be **witnessed**, **absorbed**, **braided**, and **grafted** back into the land.

This is not a spell collection menu. Powers live in your body as attunements, leak into traversal and combat, and combine in a dream-geography called **the Weft**.

## The Weft (the mechanic you did not ask for)

When you rest at a Weft Camp in Hearthmere (or a camp you build), you fall inward. Every song you have stolen becomes a place you can walk. Lift one mote. Carry it into another. Some braids become new laws of your body. Some refuse to hold and flicker anyway.

The waking world will not list the combinations. The Chorus only hints.

## Run locally

```bash
npm install
npm run dev
```

Open the printed localhost URL. Click the canvas to capture the mouse.

## Play

- **WASD** move, **mouse** look, **Shift** sprint, **Space** jump (hold in air to glide once you have wind)
- **Click** to strike
- **F** to take, speak, hold-to-absorb, or place
- **Q / E / R** surge whatever is attuned to those limbs
- **1 / 2 / 3** cycle attunement
- **C** hearth (build / infuse), **Tab** journal, **H** controls

Look north from Hearthmere. The white commas in the sky are stormkites. The too-long silhouette on the northeast tooth is Skybreaker. You can see both long before you can take them.

## World

- **Hearthmere** — settlement, hearth, Weft camp, people who refuse to explain the system
- **Stormspine** — kites, sentinels, lodestone titan
- **Emberwaste** — lizards that cough kilns
- **Mycelial Dark** — a forest that is one thought; hidden veins
- **Tideglass Shore** — water that can be convinced to be a road
- **Skybreaker Crag** — a boss that changes how you travel
- Hidden rooms: waterfall cave, settlement cellar, sky-shard, spore grove, and a tear that only opens if you take too much without grafting a totem back

## Stack

Next.js, React Three Fiber, custom GLSL sky/water, postprocessing bloom, Web Audio drones, local save.

No account. No backend. Your memory of the Vale lives in the browser.
