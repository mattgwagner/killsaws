// Trims research/roster.json down to what the game shows on bot cards.
import fs from 'node:fs';
const roster = JSON.parse(fs.readFileSync('research/roster.json', 'utf8'));
const out = roster.map((b) => ({
  id: b.id,
  name: b.name,
  team: b.team,
  captain: b.builders?.captain ?? null,
  hometown: b.hometown,
  debut: b.debutSeason?.rebootDebut ?? null,
  weaponType: b.weaponType,
  weapon: b.weaponDescription,
  armor: b.armor?.materials ?? [],
  giantNuts: (b.achievements?.giantNutWins ?? []).map((w) => `${w.event} (${w.year})`),
  runnerUp: (b.achievements?.runnerUp ?? []).map((w) => `${w.event} (${w.year})`),
  awards: (b.achievements?.otherAwards ?? []).slice(0, 4),
  records: (b.achievements?.notableRecords ?? []).slice(0, 4),
  fights: (b.famousFights ?? []).map((f) => ({ opponent: f.opponent, season: f.season, summary: f.summary, result: f.result })),
  trivia: b.trivia,
  selfRighting: b.drive?.selfRighting ?? null,
  uncertain: b.uncertain ?? [],
  sources: (b.sources ?? []).slice(0, 3),
}));
fs.writeFileSync('src/data/lore.json', JSON.stringify(out, null, 1));
const rules = JSON.parse(fs.readFileSync('research/rules.json', 'utf8'));
fs.writeFileSync('src/data/rules.json', JSON.stringify(rules, null, 1));
console.log('lore', out.length, 'bots,', fs.statSync('src/data/lore.json').size, 'bytes');
