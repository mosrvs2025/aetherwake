export type PowerTag =
  | "wind"
  | "stone"
  | "storm"
  | "fire"
  | "spore"
  | "tide"
  | "root"
  | "glass"
  | "night"
  | "sky"
  | "motion"
  | "form"
  | "sense"
  | "wild"
  | "hollow";

export type PowerId =
  | "hollow_pulse"
  | "gale_whisper"
  | "gale_feather"
  | "basalt_hide"
  | "storm_vein"
  | "ember_tongue"
  | "spore_sight"
  | "tide_step"
  | "root_bind"
  | "glass_echo"
  | "night_veil"
  | "lodestone_blood"
  | "skybreaker_heart"
  | "thermal_column"
  | "lodestone_crash"
  | "pollen_veil"
  | "steam_shroud"
  | "true_soar"
  | "living_bastion"
  | "underdream"
  | "stormwake"
  | "cinder_trail"
  | "blink_step"
  | "world_vein"
  | "ashen_lung"
  | "unstable";

export interface PowerDef {
  id: PowerId;
  name: string;
  secret: string;
  tags: PowerTag[];
  color: string;
  rgb: [number, number, number];
  source: string;
  body: string;
  surge: string;
  seen: string;
  witnessed: string;
  grasped: string;
  chorus: string[];
}

export const POWERS: Record<PowerId, PowerDef> = {
  hollow_pulse: {
    id: "hollow_pulse",
    name: "Hollow Pulse",
    secret: "The Vale's leftover heartbeat.",
    tags: ["sense", "hollow"],
    color: "#c4b5fd",
    rgb: [0.77, 0.71, 0.99],
    source: "yourself",
    body: "Nearby living powers shimmer. You were born already listening.",
    surge: "For a breath, the world shows every unclaimed song.",
    seen: "You have always felt it.",
    witnessed: "You have always felt it.",
    grasped: "The Pulse is not a gift. It is a wound that learned to see.",
    chorus: ["Look with the part of you that is still empty."],
  },
  gale_whisper: {
    id: "gale_whisper",
    name: "Gale Whisper",
    secret: "A feather's unfinished sentence.",
    tags: ["wind", "motion"],
    color: "#e0f2fe",
    rgb: [0.88, 0.95, 1],
    source: "a fallen plume",
    body: "Falls slow, as if the air is considering you.",
    surge: "A short hop of air. Not flight. A rumor of it.",
    seen: "A feather on the road still hums.",
    witnessed: "It wants to go up. It does not remember how.",
    grasped: "The wind knows your name now, but only the first syllable.",
    chorus: ["Higher. Not yet. Higher."],
  },
  gale_feather: {
    id: "gale_feather",
    name: "Gale Feather",
    secret: "The stormkite's refusal to fall.",
    tags: ["wind", "motion"],
    color: "#7dd3fc",
    rgb: [0.49, 0.83, 0.99],
    source: "Stormkite",
    body: "Hold the jump in open air and the Vale will carry you.",
    surge: "A burst of forward air.",
    seen: "White commas cut the northern sky.",
    witnessed: "Wings fold. The bird does not drop. The air becomes a floor.",
    grasped: "You steal the floor. It was never stone.",
    chorus: ["Do not flap. Trust the theft."],
  },
  basalt_hide: {
    id: "basalt_hide",
    name: "Basalt Hide",
    secret: "A mountain's patience, worn as skin.",
    tags: ["stone", "form"],
    color: "#a8a29e",
    rgb: [0.66, 0.64, 0.62],
    source: "Basalt Sentinel",
    body: "Blows land softer. You are heavier. The ground likes you more.",
    surge: "Skin hardens to a cracking shell for a few heartbeats.",
    seen: "The ridges walk when they think no one is looking.",
    witnessed: "A fist of rock shrugs off lightning like weather.",
    grasped: "You put a cliff on.",
    chorus: ["Be late. Be heavy. Be still enough to win."],
  },
  storm_vein: {
    id: "storm_vein",
    name: "Storm Vein",
    secret: "Lightning that wanted a bloodstream.",
    tags: ["storm", "motion"],
    color: "#93c5fd",
    rgb: [0.58, 0.77, 0.99],
    source: "Stormspine beasts / Lodestone Titan",
    body: "Sprint leaves a crackle. The air tastes like coins.",
    surge: "A short, violent dash. What you pass through remembers.",
    seen: "The northern teeth keep a private storm.",
    witnessed: "A body becomes a bolt and arrives already angry.",
    grasped: "You keep a storm in a vein it did not ask for.",
    chorus: ["Ask the shortest path. It is usually a wound."],
  },
  ember_tongue: {
    id: "ember_tongue",
    name: "Ember Tongue",
    secret: "A lizard's cough, taught to speak.",
    tags: ["fire", "wild"],
    color: "#fb923c",
    rgb: [0.98, 0.57, 0.24],
    source: "Embermaw",
    body: "Your strikes leave a lingering heat. Camps accept you.",
    surge: "Spit a coin of fire.",
    seen: "The east is cracked and breathing.",
    witnessed: "A throat opens. The air becomes a kiln.",
    grasped: "You learn a language made of coughs.",
    chorus: ["Hunger is a kind of weather."],
  },
  spore_sight: {
    id: "spore_sight",
    name: "Spore Sight",
    secret: "The forest's private correspondence.",
    tags: ["spore", "sense"],
    color: "#c084fc",
    rgb: [0.75, 0.52, 0.99],
    source: "Sporecap Stag",
    body: "Hidden threads under the soil become visible. Caches hum.",
    surge: "For a moment the underground writes itself in light.",
    seen: "The south wears too many hats.",
    witnessed: "A stag listens with its antlers. The ground answers.",
    grasped: "You are copied into the network. It is not optional.",
    chorus: ["We were talking before you had a mouth."],
  },
  tide_step: {
    id: "tide_step",
    name: "Tide Step",
    secret: "Water agreeing, briefly, to be a road.",
    tags: ["tide", "motion"],
    color: "#2dd4bf",
    rgb: [0.18, 0.83, 0.75],
    source: "Tidewight",
    body: "Shallow water holds your weight. You move like a rumor on glass.",
    surge: "A push of current. Enemies lose their footing.",
    seen: "West, figures stand on the shining as if it were a floor.",
    witnessed: "A wight walks across the lung of the world and does not sink.",
    grasped: "The shore files you under 'weather'.",
    chorus: ["Be late, like a wave. Then arrive all at once."],
  },
  root_bind: {
    id: "root_bind",
    name: "Rootbind",
    secret: "A climbing argument with gravity.",
    tags: ["root", "form"],
    color: "#86efac",
    rgb: [0.53, 0.94, 0.67],
    source: "Rootwraith",
    body: "Steep stone becomes a ladder if you keep moving.",
    surge: "Vines lash out and hold a thing still.",
    seen: "The vale's edges twitch like sleeping hands.",
    witnessed: "A tangle stands up, walks, and refuses to fall off a wall.",
    grasped: "Your fingers remember being roots.",
    chorus: ["Hold. Hold. Hold. Then drink."],
  },
  glass_echo: {
    id: "glass_echo",
    name: "Glass Echo",
    secret: "A moth's habit of being in two dusks.",
    tags: ["glass", "motion"],
    color: "#f5d0fe",
    rgb: [0.96, 0.82, 1],
    source: "Glasswing Moth",
    body: "When you dodge, a pale double stays behind and confuses hunters.",
    surge: "Leave a ringing afterimage and step aside.",
    seen: "At the unsure hour, wings like windows.",
    witnessed: "The moth is struck. The moth is also two steps left.",
    grasped: "You learn to be a reflection that walks away.",
    chorus: ["Be the lie that survives."],
  },
  night_veil: {
    id: "night_veil",
    name: "Night Veil",
    secret: "A flower's opinion of the dark.",
    tags: ["night", "sense"],
    color: "#818cf8",
    rgb: [0.51, 0.55, 0.97],
    source: "Nightbloom",
    body: "Darkness thins. Secrets that only open at night become honest.",
    surge: "A brief true-dark: you see the Weft leaking through.",
    seen: "A closed fist of petals in the western ditch.",
    witnessed: "It opens only when the sun is elsewhere. The air changes color.",
    grasped: "You borrow a flower's night.",
    chorus: ["Some doors are just hours."],
  },
  lodestone_blood: {
    id: "lodestone_blood",
    name: "Lodestone Blood",
    secret: "Iron that misses other iron.",
    tags: ["stone", "storm", "form"],
    color: "#94a3b8",
    rgb: [0.58, 0.64, 0.72],
    source: "Lodestone Titan",
    body: "Metal and storm-things lean toward you. Your steps pull grit.",
    surge: "Yank nearby creatures off their feet.",
    seen: "A walking quarry on the high north shelf.",
    witnessed: "Lightning hits it and stays, like a pet.",
    grasped: "Your blood learns a direction.",
    chorus: ["Everything wants to arrive."],
  },
  skybreaker_heart: {
    id: "skybreaker_heart",
    name: "Heart of the Updraft",
    secret: "A god's leftover wingbeat.",
    tags: ["sky", "wind", "motion"],
    color: "#fde68a",
    rgb: [0.99, 0.9, 0.54],
    source: "Skybreaker",
    body: "A second jump, stolen from a thing that was never meant to land.",
    surge: "Kick the air so hard it becomes a stair.",
    seen: "A silhouette that is too long for any bird you know.",
    witnessed: "The crag is a drum. The drum is a wing. The wing is a weather system.",
    grasped: "You put a storm's heart where yours used to be. They share.",
    chorus: ["The sky is not above you. It is a room you have not entered."],
  },
  thermal_column: {
    id: "thermal_column",
    name: "Thermal Column",
    secret: "Wind that learned hunger.",
    tags: ["wind", "fire", "motion"],
    color: "#fdba74",
    rgb: [0.99, 0.73, 0.45],
    source: "braid",
    body: "Fire you make becomes lift. Glide over your own kilns.",
    surge: "Ignite an updraft under your feet.",
    seen: "Grass that flies.",
    witnessed: "Heat standing up like a pillar.",
    grasped: "You taught weather to cook.",
    chorus: ["Rise by burning the floor."],
  },
  lodestone_crash: {
    id: "lodestone_crash",
    name: "Lodestone Crash",
    secret: "A mountain arriving all at once.",
    tags: ["stone", "storm", "form"],
    color: "#64748b",
    rgb: [0.39, 0.46, 0.55],
    source: "braid",
    body: "Falling becomes a weapon. The ground answers with a ring of force.",
    surge: "Dive and strike as a meteor of ore.",
    seen: "The ridge that learned to fall.",
    witnessed: "Weight and spark agreeing.",
    grasped: "You are the shortest path between sky and stone.",
    chorus: ["Arrive."],
  },
  pollen_veil: {
    id: "pollen_veil",
    name: "Pollen Veil",
    secret: "A forest's sneeze, aimed.",
    tags: ["spore", "wind", "sense"],
    color: "#d8b4fe",
    rgb: [0.85, 0.71, 1],
    source: "braid",
    body: "A drifting cloud reveals hidden things and thickens enemy lungs.",
    surge: "Exhale a seeing fog.",
    seen: "Gold dust that thinks.",
    witnessed: "Wind carrying a secret.",
    grasped: "You become the rumor.",
    chorus: ["Breathe us. We will breathe you back."],
  },
  steam_shroud: {
    id: "steam_shroud",
    name: "Steam Shroud",
    secret: "A disappearance made of weather.",
    tags: ["tide", "fire", "form"],
    color: "#99f6e4",
    rgb: [0.6, 0.96, 0.89],
    source: "braid",
    body: "You blur. Edges forget you. Strikes miss as if you were a rumor.",
    surge: "Become a walking cloud for a few seconds.",
    seen: "A person-shaped absence over water.",
    witnessed: "Heat meeting glass.",
    grasped: "You are harder to name.",
    chorus: ["Be weather, not a target."],
  },
  true_soar: {
    id: "true_soar",
    name: "True Soar",
    secret: "Flight, without the metaphor.",
    tags: ["sky", "wind", "motion"],
    color: "#fef3c7",
    rgb: [0.99, 0.95, 0.78],
    source: "braid",
    body: "The air is a country. You may visit it, briefly, as a citizen.",
    surge: "A genuine climb into the sky.",
    seen: "A person where a bird should be.",
    witnessed: "Two thefts agreeing to be a law.",
    grasped: "You stop pretending not to be a storm.",
    chorus: ["The room has no floor. Good."],
  },
  living_bastion: {
    id: "living_bastion",
    name: "Living Bastion",
    secret: "A wall that remembers being a forest.",
    tags: ["root", "stone", "form"],
    color: "#a3e635",
    rgb: [0.64, 0.9, 0.21],
    source: "braid",
    body: "You can grow brief fortifications from soil and patience.",
    surge: "Raise a living wall.",
    seen: "Stone putting out leaves.",
    witnessed: "The land taking your side.",
    grasped: "Architecture is a kind of root.",
    chorus: ["Stand where you planted yourself."],
  },
  underdream: {
    id: "underdream",
    name: "Underdream",
    secret: "Night, looking inward.",
    tags: ["spore", "night", "sense", "hollow"],
    color: "#a78bfa",
    rgb: [0.65, 0.55, 0.98],
    source: "braid",
    body: "Weft-leaks become visible in the waking vale. Hidden rooms have outlines.",
    surge: "Phase a step toward the inner world.",
    seen: "A second vale painted on the first.",
    witnessed: "Sleep walking around in daylight.",
    grasped: "You keep a dream in your open eyes.",
    chorus: ["We were always under the floorboards."],
  },
  stormwake: {
    id: "stormwake",
    name: "Stormwake",
    secret: "Lightning taught to swim.",
    tags: ["storm", "tide", "motion"],
    color: "#67e8f9",
    rgb: [0.4, 0.91, 0.98],
    source: "braid",
    body: "Charged water becomes a road and a weapon. Chains jump between wet things.",
    surge: "Write a line of voltage across the shore.",
    seen: "A glittering scar on the tide.",
    witnessed: "Polite lightning.",
    grasped: "You asked the water to hurry. It agreed, once.",
    chorus: ["Conduct."],
  },
  cinder_trail: {
    id: "cinder_trail",
    name: "Cinder Trail",
    secret: "A fire that refuses to finish.",
    tags: ["fire", "night", "wild"],
    color: "#f97316",
    rgb: [0.98, 0.45, 0.09],
    source: "braid",
    body: "Where you walk, a slow burn follows, lingering like a grudge.",
    surge: "Lay a snake of coals.",
    seen: "Footsteps that stay angry.",
    witnessed: "Night keeping a kiln warm.",
    grasped: "You taught fire to wait.",
    chorus: ["Do not put it out. Teach it manners."],
  },
  blink_step: {
    id: "blink_step",
    name: "Blink Step",
    secret: "Wind, impatient.",
    tags: ["wind", "glass", "motion"],
    color: "#e9d5ff",
    rgb: [0.91, 0.84, 1],
    source: "braid",
    body: "A few steps cease to exist. You arrive having skipped the argument.",
    surge: "Fold a short distance.",
    seen: "A person with missing frames.",
    witnessed: "Haste marrying a lie.",
    grasped: "You edit the path.",
    chorus: ["Omit."],
  },
  world_vein: {
    id: "world_vein",
    name: "World Vein",
    secret: "The forest's postal service.",
    tags: ["spore", "root", "motion"],
    color: "#34d399",
    rgb: [0.2, 0.83, 0.6],
    source: "braid",
    body: "Step into a glowing thread and emerge from another. The south is a city of doors.",
    surge: "Ride the nearest vein.",
    seen: "A person swallowed by grass, politely.",
    witnessed: "Root and rumor agreeing on a schedule.",
    grasped: "You mail yourself.",
    chorus: ["Address unknown. Arriving anyway."],
  },
  ashen_lung: {
    id: "ashen_lung",
    name: "Ashen Lung",
    secret: "Fire that inhales.",
    tags: ["fire", "hollow", "form"],
    color: "#fb7185",
    rgb: [0.98, 0.44, 0.52],
    source: "braid",
    body: "You drink small flames and spit them larger. Hollow-heat does not burn you.",
    surge: "Inhale nearby fire, then return it twice.",
    seen: "A kiln going quiet around a person.",
    witnessed: "Hunger meeting smoke.",
    grasped: "You are a chimney that walks.",
    chorus: ["Feed me. I will keep you warm."],
  },
  unstable: {
    id: "unstable",
    name: "Unstable Braid",
    secret: "A sentence that will not stay written.",
    tags: ["wild", "hollow"],
    color: "#f0abfc",
    rgb: [0.94, 0.67, 0.99],
    source: "failed braid",
    body: "Something flickers through your nerves. It will not last.",
    surge: "A chaotic burst — knockback, spark, or lift. Even you are surprised.",
    seen: "A color that does not have a name yet.",
    witnessed: "Two songs arguing.",
    grasped: "It will not stay. That is the point.",
    chorus: ["Again. Differently."],
  },
};

export const ITEM_NAMES: Record<string, string> = {
  splinterwood: "Splinterwood",
  shardstone: "Shardstone",
  embercoal: "Embercoal",
  stormglass: "Stormglass",
  sporegel: "Sporegel",
  tidepearl: "Tidepearl",
  kiteplume: "Kiteplume",
  nightiron: "Nightiron",
  weftseed: "Weftseed",
  hollowash: "Hollowash",
  basaltheart: "Basaltheart",
  quickglass: "Quickglass",
  fallen_plume: "Fallen Plume",
};

export const ITEM_FLAVOR: Record<string, string> = {
  splinterwood: "It still tries to be a tree when you aren't looking.",
  shardstone: "Cold. Older than the Vale's current opinion of itself.",
  embercoal: "Warm even in a pocket. Hungry even then.",
  stormglass: "A bottled argument between air and light.",
  sporegel: "If you listen, it is counting.",
  tidepearl: "A lung, miniaturized.",
  kiteplume: "It lifts when you sigh.",
  nightiron: "Darker than it has any right to be at noon.",
  weftseed: "A dream that has not decided on a plant yet.",
  hollowash: "What is left when a power is taken and not returned.",
  basaltheart: "It beats so slowly you might call it geology.",
  quickglass: "Impatient sand.",
  fallen_plume: "The wind's unfinished letter.",
};

export interface Recipe {
  id: string;
  a: PowerId;
  b: PowerId;
  out: PowerId;
  whisper: string;
}

export const RECIPES: Recipe[] = [
  { id: "r1", a: "gale_feather", b: "ember_tongue", out: "thermal_column", whisper: "The wind learns to burn without dying." },
  { id: "r2", a: "storm_vein", b: "basalt_hide", out: "lodestone_crash", whisper: "Weight and spark agree on a single arrival." },
  { id: "r3", a: "spore_sight", b: "gale_feather", out: "pollen_veil", whisper: "A forest learns to travel." },
  { id: "r4", a: "tide_step", b: "ember_tongue", out: "steam_shroud", whisper: "You become weather, not a target." },
  { id: "r5", a: "gale_feather", b: "skybreaker_heart", out: "true_soar", whisper: "The sky files you as a citizen." },
  { id: "r6", a: "root_bind", b: "basalt_hide", out: "living_bastion", whisper: "The land takes your side, briefly." },
  { id: "r7", a: "spore_sight", b: "night_veil", out: "underdream", whisper: "Sleep starts walking around in daylight." },
  { id: "r8", a: "storm_vein", b: "tide_step", out: "stormwake", whisper: "Water agrees to hurry." },
  { id: "r9", a: "ember_tongue", b: "night_veil", out: "cinder_trail", whisper: "Fire is taught to wait." },
  { id: "r10", a: "gale_feather", b: "glass_echo", out: "blink_step", whisper: "A few steps cease to exist." },
  { id: "r11", a: "spore_sight", b: "root_bind", out: "world_vein", whisper: "You mail yourself through the south." },
  { id: "r12", a: "ember_tongue", b: "hollow_pulse", out: "ashen_lung", whisper: "Hunger meeting smoke." },
  { id: "r13", a: "lodestone_blood", b: "storm_vein", out: "lodestone_crash", whisper: "The titan was already a combination. You finish it." },
  { id: "r14", a: "gale_whisper", b: "gale_feather", out: "gale_feather", whisper: "The unfinished sentence finds its verb." },
];

export function findRecipe(a: PowerId, b: PowerId): Recipe | undefined {
  return RECIPES.find(
    (r) => (r.a === a && r.b === b) || (r.a === b && r.b === a),
  );
}

export const INFUSIONS: Record<string, { tag: string; whisper: string }> = {
  quickglass: { tag: "haste", whisper: "It will not wait. Neither will you." },
  nightiron: { tag: "linger", whisper: "The song agrees to stay after the singer leaves." },
  weftseed: { tag: "lucid", whisper: "The power dreams more loudly." },
  hollowash: { tag: "invert", whisper: "It turns itself inside out and keeps going." },
  embercoal: { tag: "kindle", whisper: "Everything it touches wants to be a kiln." },
  stormglass: { tag: "volt", whisper: "The air around it becomes impatient." },
  sporegel: { tag: "spread", whisper: "It copies itself into nearby possibilities." },
  tidepearl: { tag: "flow", whisper: "Edges soften. Timing changes." },
  basaltheart: { tag: "anchor", whisper: "It refuses to be hurried, even as a miracle." },
  kiteplume: { tag: "lift", whisper: "Gravity files a complaint." },
};

export function slotsUnlocked(absorbedCount: number, weftVisited: boolean) {
  if (absorbedCount >= 6 || weftVisited) return 3;
  if (absorbedCount >= 3) return 2;
  if (absorbedCount >= 1) return 1;
  return 1;
}
