// The BattleBox (World Championship VI-VII layout): 48 x 48 ft steel floor
// in 4 x 4 ft panels, raised Lexan box, spiked perimeter rail, red and blue
// squares on opposite sides with the screws behind each, the Upper Deck
// against the far wall, two team-controlled Pulverizers, and killsaw sets
// in the central band plus two pairs near the driver booths.
//
// No authoritative diagram of exact killsaw/Pulverizer coordinates exists
// (research/arena.json flags them uncertain), so positions follow broadcast
// footage. Coordinates: meters, Y up, origin at floor center. -Z is the far
// wall (Upper Deck), +Z is the door side.

export const FT = 0.3048;
export const ARENA_SIZE = 48 * FT;
export const HALF = ARENA_SIZE / 2;
export const WALL_HEIGHT = 1.2;
export const LEXAN_HEIGHT = 16 * FT; // floor to lighting rig
export const RAIL_HEIGHT = 0.2;
export const RAIL_DEPTH = 0.28;

export interface KillsawSlot { id: string; x: number; z: number; axis: 'x' | 'z'; radius: number; set: string }
export interface ScrewHazard { id: string; x: number; z: number; axis: 'x' | 'z'; length: number; radius: number; deck?: boolean; dir: 1 | -1 }
export interface PulverizerHazard { id: string; x: number; z: number; reach: number; team: 0 | 1 }
export interface PaddleHazard { id: string; x: number; z: number; normal: { x: number; z: number }; length: number }
export interface RamrodHazard { id: string; x: number; z: number }
export interface UpperDeck { x: number; z: number; w: number; d: number; h: number }

export interface ArenaLayout {
  killsaws: KillsawSlot[];
  screws: ScrewHazard[];
  pulverizers: PulverizerHazard[];
  paddles: PaddleHazard[];
  ramrods: RamrodHazard[];
  deck: UpperDeck | null;
  starts: { x: number; z: number; yaw: number }[];
}

export function defaultLayout(): ArenaLayout {
  const sawR = 0.42; // ~33 in blades, multi-layered, 1,800 rpm
  const deck: UpperDeck = { x: 0, z: -HALF + RAIL_DEPTH + (8 * FT) / 2, w: 16 * FT, d: 8 * FT, h: 6 * 0.0254 };
  const deckFront = deck.z + deck.d / 2;
  const sx = HALF - RAIL_DEPTH - 0.38;
  return {
    killsaws: [
      // central set below the logo: four parallel slots
      ...[-1.6, -0.55, 0.55, 1.6].map((x, i) => ({ id: `saw-c${i}`, x, z: 2.0, axis: 'z' as const, radius: sawR, set: 'center' })),
      // pairs near the driver booths
      { id: 'saw-w0', x: -4.6, z: -2.4, axis: 'x', radius: sawR, set: 'west' },
      { id: 'saw-w1', x: -4.6, z: -1.5, axis: 'x', radius: sawR, set: 'west' },
      { id: 'saw-e0', x: 4.6, z: -2.4, axis: 'x', radius: sawR, set: 'east' },
      { id: 'saw-e1', x: 4.6, z: -1.5, axis: 'x', radius: sawR, set: 'east' },
    ],
    screws: [
      // behind the red (west) and blue (east) squares
      { id: 'screw-w0', x: -sx, z: -1.15, axis: 'z', length: 2.0, radius: 0.24, dir: 1 },
      { id: 'screw-w1', x: -sx, z: 1.15, axis: 'z', length: 2.0, radius: 0.24, dir: -1 },
      { id: 'screw-e0', x: sx, z: -1.15, axis: 'z', length: 2.0, radius: 0.24, dir: 1 },
      { id: 'screw-e1', x: sx, z: 1.15, axis: 'z', length: 2.0, radius: 0.24, dir: -1 },
      // Upper Deck screws on the face toward the center: tops roll toward the deck
      { id: 'deck-screw-0', x: -1.25, z: deckFront + 0.17, axis: 'x', length: 2.2, radius: 0.17, deck: true, dir: -1 },
      { id: 'deck-screw-1', x: 1.25, z: deckFront + 0.17, axis: 'x', length: 2.2, radius: 0.17, deck: true, dir: -1 },
    ],
    pulverizers: [
      { id: 'pulv-red', x: -HALF + 1.9, z: HALF - 1.9, reach: 1.15, team: 0 },
      { id: 'pulv-blue', x: HALF - 1.9, z: HALF - 1.9, reach: 1.15, team: 1 },
    ],
    paddles: [
      { id: 'paddle-w', x: -HALF + RAIL_DEPTH, z: HALF - 4.4, normal: { x: 1, z: 0 }, length: 1.8 },
      { id: 'paddle-e', x: HALF - RAIL_DEPTH, z: HALF - 4.4, normal: { x: -1, z: 0 }, length: 1.8 },
    ],
    ramrods: [
      { id: 'rr-0', x: 0, z: -0.9 }, { id: 'rr-1', x: -1.2, z: -1.6 }, { id: 'rr-2', x: 1.2, z: -1.6 },
      { id: 'rr-3', x: -2.6, z: 0.2 }, { id: 'rr-4', x: 2.6, z: 0.2 },
    ],
    deck,
    starts: [
      { x: -HALF + 3.1, z: 0, yaw: 0 }, // red square, facing east
      { x: HALF - 3.1, z: 0, yaw: Math.PI }, // blue square, facing west
    ],
  };
}
