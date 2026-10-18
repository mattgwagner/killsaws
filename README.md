# KILLSAWS

A browser robot-combat game built around the reboot-era BattleBots
heavyweights, the BattleBox, and the real rules. Built for Colton.

**Play:** https://killsaws.redleg.dev

## Modes
- **Exhibition**: any two of 25 researched heavyweights (or your Garage builds). Two players on one keyboard, gamepads, or vs AI (rookie / veteran / champion).
- **Giant Nut Tournament**: 16-robot bracket seeded by championship résumé. Your fights are played; the rest are fought out by the physics with champion AI drivers.
- **Garage**: build a 250 lb robot from real parts (armor alloys and thickness, brushless/brushed motors, gearing, tires, LiPo packs, weapon geometry). Weight, top speed, push, spin-up, stored kJ and tip speed are derived from the parts by the same model the fights use. Share codes (`KS1:…`) paste into Discord.
- **Fight Online**: host a room, paste the link, your friend joins from their browser with their own bot. The host's browser runs the physics; a Durable Object relays it.
- **Robot Files**: teams, captains, hometowns, Giant Nut history, famous fights.

## Controls
| | Red (keyboard 1) | Blue (keyboard 2) | Gamepad |
|---|---|---|---|
| Drive (arcade) | W A S D | Arrows | Left stick |
| Weapon (spinner toggle / fire) | Space | / | RT or A |
| Secondary / self-right / reverse | E | . | LT or X |
| Flamethrower | Q | , | B |
| Your team's Pulverizer | R | M | Y |

C cycles cameras (broadcast, chase, overhead, free orbit). Esc pauses.

## How the simulation works
- Rapier rigid bodies at a fixed 240 Hz. Each robot is one body (chassis hull = the same convex hull the renderer draws) plus wheel and weapon-sweep colliders.
- **Drive**: per-wheel raycast suspension; each side solves the DC motor (V = IR + ω/Kv, τ = Kt·I, ESC current limit) against tire force (μN·tanh(slip)) so traction, pushing matches and wheelspin fall out of the parts.
- **Battery**: LiPo open-circuit curve and internal resistance; heavy weapon draw sags the pack and slows the drive.
- **Spinners**: the rotor is a stored-energy state (½Iω²). A strike is an impulsive collision between the tooth (effective mass I/ρ²) and the target point (effective mass from its inertia tensor), scaled by bite (closing speed × tooth period vs tooth height). The energy that doesn't become motion is deformation, which is the damage. The reaction goes back through the axle; the rotor's gyroscopic torque acts on the chassis.
- **Damage**: armor panels per face with capacity = area × thickness × material toughness; overflow reaches drive motors, weapon, battery (LiPo fires) and electronics. Wheels can be torn off. Debris is physical.
- **Arena**: WC VI–VII BattleBox. Killsaws fire in the final minute (WOPR pattern), screws behind both squares, Upper Deck with reversing screws and its own count, team-controlled Pulverizers, paddles, ramrods, spiked rail.
- **Rules**: no tap-outs; KO count (10 as broadcast, or the 2021 rulebook's 20 with the last 10 called); a pin/lift is limited to 10 s before the refs separate; three judges score Damage 5 / Aggression 3 / Control 3.

Research and sources are in `research/` (roster, arena, rules, notes). Numbers the sources don't publish are builder-plausible estimates and are flagged per bot in Robot Files.

## Dev
```
npm install
npm run dev          # vite + worker (rooms) on :5180
npm test             # sim bounds: weights, self-righting, 20 seeded AI fights
npm run build && npx wrangler deploy
node e2e/online.mjs http://localhost:5180 out.png   # two-browser online test
```
`scripts/simcheck.ts N` runs N headless AI fights; `scripts/weights.ts` prints the roster's weigh-in and weapon numbers.
