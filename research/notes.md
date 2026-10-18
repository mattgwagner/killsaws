# Research notes

Researched 2026-10-18. Files in this folder:

- `roster.json`: 25 heavyweights
- `arena.json`: the BattleBox and its hazards
- `rules.json`: rules, judging and champions

## Robot Rumble 2: what it offers

Store page: https://store.steampowered.com/app/884180/Robot_Rumble_2/ (Nerd Island Studios, LLC; released Sep 3, 2024; free to play; Windows, plus experimental macOS; still in active development; "Very Positive" reviews, about 80% of ~300)

- **Bot Lab builder** built from a large catalogue of parts modelled on real hardware.
- **Electronics simulation**: you pair electric motors, speed controllers (ESCs) and batteries, and the game simulates how well they match.
- **Pneumatics**: cylinders, valves and air tanks for building flippers.
- **Power transmission**: chains, belts and gearboxes, so you can gear for a fast spinner or a high-torque lifter.
- **Construction**: basic primitives plus custom shapes. The website also mentions a built-in 3D modelling tool for custom parts.
- **Materials**: they use real-world material data.
- **Damage model**: based on the strength of welded and bolted connections, so parts break off at their joints. There is no stated deformation or denting model.
- **Cosmetics**: props, mechanical decorative parts, decals and custom shapes.
- **AI scripting**: a built-in MiniScript editor for programming autonomous bots. AI vs AI battles can give each bot its own script.
- **Weight classes**: real-world classes, from 3 lb beetleweight (1.5 kg) to 340 lb super heavyweight (154 kg).
- **Arenas**: several, with hazards such as hammers, rollers and pits. Players share custom arenas through Discord by dropping them into the game folder (there is no Steam Workshop).
- **Modes**: AI vs AI, Player vs AI, and local PvP, all with up to 4 robots on one screen.
- **Online PvP**: none built in. It relies on Steam Remote Play Together or the third-party tool Parsec.
- **Sharing**: robots are imported and exported as `.RR2Bot` files and shared on Discord. The Discord community runs weekly competitions and tournaments.
- **Missing from the store page**: no career or campaign mode, no licensed real robots, no recreation of the real BattleBox, no judges or KO-count rules, no replay or broadcast camera, and no native online matchmaking.

### Where we can match or beat it

- Native online multiplayer (WebRTC or a relay) instead of Remote Play or Parsec.
- A faithful BattleBox: killsaws in the final minute, bidirectional screws, team-triggered Pulverizers, the Upper Deck with its 10-count, and the out-of-the-arena / Door Buffer Zone rules.
- Real officiating: a referee count (20, with the last 10 called aloud), 10-count pin limits, 30-count grapple limits, no tap-outs, and the 11-point judges' matrix (Damage 5 / Aggression 3 / Control 3) with split and unanimous decisions.
- Iconic real bots and a career mode that follows a season's structure: Fight Night, then a seeded Top 32/16 bracket, then the Giant Nut. Champions / Golden Bolt could be an endgame.
- Damage beyond joint strength: armor deformation, wheel loss, belt or chain failure, and battery fires (LiPo smoke counts as damage in the judges' guide).
- Broadcast-style presentation: announcer intros, a judges' scorecard reveal, and replays.
- Note: RR2's electronics and pneumatics depth is its real strength. A browser game has to choose deliberately whether to compete on simulation depth or on authenticity and presentation.

## Accuracy caveats (read before shipping content)

### Season naming
- Use "World Championship I-VII" as the canonical label. Filming and airing years differ for two seasons:
  - WC VI was filmed in Aug-Sep 2021 and aired from Jan 2022.
  - WC VII was filmed in Oct 2022 and aired from Jan 2023.
- Wikipedia lists these two seasons as 2022 and 2023, and the fandom wiki as 2021 and 2022. `rules.json` gives both.
- Pre-2018 numbering is inconsistent across sources (ABC Season 1/2 vs Season 6/7), and so is the airing of WC V (2020 filming, aired Dec 2020-2021).

### Post-2022 history
- There has been no WC VIII. After WC VII and Champions II, Discovery dropped the show.
- Events since then have been untelevised: Destruct-A-Thon live shows, Proving Ground (from Dec 2023), FaceOffs (2024-25), and the 2026 Pro League on YouTube.
- The Pro League champion was still "TBD" on the wiki's anti-spoiler page during research.
- SawBlaze remains the reigning Giant Nut holder.

### Champions
- Champions, runners-up and final results were verified against the fandom wiki season pages:
  - 2015: Bite Force beat Tombstone, unanimous judges' decision (JD).
  - 2016: Tombstone beat Bombshell by KO.
  - 2018: Bite Force beat Minotaur by KO at 2:05.
  - 2019: Bite Force beat Witch Doctor by KO.
  - 2020: End Game beat Whiplash by KO.
  - 2021: Tantrum beat Witch Doctor by KO.
  - 2022: SawBlaze beat HUGE, unanimous JD.
- Bite Force won 2015 as a tracked grappler/lifter control bot, and 2018-2019 as a vertical bar spinner. Its `weaponType` reflects the spinner version. A 2015 skin needs a different model.
- Son of Whyachi's Giant Nut is from Comedy Central Season 3.0 (2001), not the reboot. It is flagged that way in `roster.json`.

### Rules nuances a superfan may test
- **Count**: the 2021 rulebook says the referee counts down from 20 and calls the last 10 aloud. Wikipedia simplifies this to "10 seconds".
- **Pins**: the 2021 rulebook limits a pin to 10 counts and a grapple to 30. Wikipedia says 30 seconds for both.
- **Tap-outs** are explicitly not allowed.
- **Pro League 2026** judges on Damage + Engagement only.

### Arena
- No authoritative published diagram exists for exact killsaw positions or blade counts, or for Pulverizer corners. Those fields are flagged `"uncertain": true`, so build them from broadcast footage.
- Screw material conflicts: titanium (2015) vs the stainless steel quoted on air (2018).

### Roster
- **Hex colours** are approximations from official photos and descriptions. They are listed in each bot's `uncertain` array where the agent couldn't confirm the shade. Most bots changed paint between seasons. The descriptions target the best-known (usually 2018-2022) version.
- **Weapon specs** are thin in public sources. Unknown numbers are `null` rather than guessed. Some figures are season-specific or conflicting, as recorded in `weaponSpecs.notes`:
  - Tombstone's tip speed: ~200 mph after being turned down in 2018 vs 235 mph quoted on TV.
  - Minotaur's drum RPM fell season by season: 12k, 11k, 9k, then 8k.
  - Gigabyte's tip speed: 161, ~170 or 188 mph depending on the source.
  - ROTATOR's 300 mph is its 2016 per-disk figure.
  - Son of Whyachi's 390 rpm and 5 ft rotor are classic-era figures.
- **Hometown conflicts** between the wiki and battlebots.com (all versions are recorded in the field):
  - Hydra: Dorchester vs Abbotsford, WI
  - Bloodsport: Cambridge vs Somerville, MA
  - Tantrum: Mountain View vs San Diego / Cambridge
  - Copperhead: Denver vs Loveland vs Erie, CO
  - DUCK!: Palo Alto vs Hillsborough, CA
- **Name styling**: battlebots.com and the wiki style these in caps as "HUGE", "DUCK!" and "ROTATOR". The roster follows that.
- **Captains changed over time**, and fields note which season each applies to:
  - Tantrum: Aren Hill until WC V, then Alex Grant and Ginger Schmidt.
  - Gigabyte and Cobalt (Robotic Death Company).
  - Valkyrie: Lucy Du in WC VII.
- **Whiplash** is classed `vertical-disk`, with `weaponTypeSecondary: "lifter"`, because its disk sits on a 180-degree lifting arm.
- **Fight details worth knowing**:
  - HyperShock's famous garden-rake drone takedown was against Warrior Clan (2016).
  - Bite Force's only competitive loss was to Chomp (JD, WC II Round of 16).
  - Valkyrie vs Malice (WC VII) was first given to Valkyrie and then overturned on Malice's appeal, the first successful appeal.
  - Cobalt vs Whiplash (WC VI) was a double KO, decided 2-1 for Cobalt by the judges.
  - Witch Doctor vs Minotaur (WC VI quarter-final) was a controversial unanimous decision, scored 6-5 on all three cards.

### Sources
- **BattleBots fandom wiki**, pulled via its MediaWiki API because the HTML site blocks fetches. The cited URLs are the normal `battlebots.fandom.com/wiki/...` pages.
- **battlebots.com robot pages** and rule PDFs:
  - 2018 Design Rules
  - 2021 Tournament Rules
  - 2022 Judges' Guide
- **Wikipedia**
- **Builder interviews** (Reddit AMAs, a Xometry case study) where noted.
