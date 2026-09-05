/**
 * REALMS — the road network.
 *
 * Authored as plan-view splines only; their elevation is derived and graded by
 * the height function (see heightfield.ts), which is what guarantees the whole
 * route stays walkable no matter how the terrain noise shifts underneath it.
 */

/** The King's Road: cliff -> wood -> village -> the Riftspan -> the Keep. */
export const ROAD_MAIN: Array<[number, number]> = [
  [74, 654], [52, 566], [26, 486], [-14, 420], [-64, 356], [-110, 300],
  [-140, 250], [-152, 186], [-136, 120], [-112, 54], [-96, -14], [-84, -60],
  [-70, -104], [-66, -244], [-64, -300], [-62, -364], [-60, -430], [-58, -496], [-60, -556],
];

/** A side track from the village out to Mirrowmere's western shore. */
export const ROAD_LAKE: Array<[number, number]> = [
  [-140, 250], [-60, 226], [20, 206], [80, 184], [130, 168], [172, 178],
];

/** An old processional way from the road down to the Colonnade. */
export const ROAD_RUIN: Array<[number, number]> = [
  [-110, 300], [-190, 312], [-266, 322], [-330, 330], [-372, 336],
];
