/**
 * Parse weapon buff tier data from the md file.
 * Outputs weaponBuffTiers.json with per-tier description text.
 * Also updates gamedata.json weapon names where they differ.
 *
 * Usage: node scripts/parseWeaponBuffTiers.js
 */
const fs = require('fs')
const path = require('path')

const MD_PATH = path.resolve(__dirname, '../熔铸火焰.md')
const GAMEDATA_PATH = path.resolve(__dirname, '../apps/endaxis-web/public/gamedata.json')
const OUTPUT_PATH = path.resolve(__dirname, '../apps/endaxis-web/src/data/weaponBuffTiers.json')

const text = fs.readFileSync(MD_PATH, 'utf-8')
const gamedata = JSON.parse(fs.readFileSync(GAMEDATA_PATH, 'utf-8'))
const weapons = gamedata.weaponDatabase

// ── Step 1: Parse md into weapon blocks ──
const lines = text.split('\n')
const weaponBlocks = []
let i = 0
while (i < lines.length) {
  if (!lines[i].trim()) { i++; continue }
  const line = lines[i].trim()
  if (/^\d/.test(line) || line.startsWith('Rank') || line.startsWith('同名') ||
      line.startsWith('装备') || line.startsWith('对') || line.startsWith('场') ||
      line.startsWith('每') || line.startsWith('敌')) { i++; continue }

  const weaponName = line
  i++
  while (i < lines.length && !lines[i].trim()) i++
  if (i >= lines.length || !lines[i].startsWith('Rank\t')) continue
  const headerParts = lines[i].split('\t')
  const buffEntryName = headerParts[3] || null
  i++

  const tiers = []
  while (i < lines.length && tiers.length < 9) {
    const l = lines[i].trim()
    if (!l) { i++; continue }
    const match = l.match(/^(\d)\t/)
    if (match) {
      const parts = lines[i].split('\t')
      const descLines = [parts.slice(3).join('\t')]
      i++
      while (i < lines.length) {
        const nl = lines[i].trim()
        if (!nl || /^\d\t/.test(nl)) break
        descLines.push(nl)
        i++
      }
      tiers.push({ tier: parseInt(match[1]), desc: descLines.join('\n') })
    } else {
      i++
    }
  }
  weaponBlocks.push({ name: weaponName, buffEntryName, tiers })
}

console.log(`Parsed ${weaponBlocks.length} weapons from md`)

// ── Step 2: Match to gamedata ──
const NAME_ALIASES = {
  '显锋': '应急手段',
  '作品：蚀迹': '作品：蚀象',
}

const output = []
const nameUpdates = []
let matched = 0

for (const block of weaponBlocks) {
  let weapon = weapons.find(w => w.name === block.name)
  if (!weapon && NAME_ALIASES[block.name]) {
    weapon = weapons.find(w => w.name === NAME_ALIASES[block.name])
  }
  if (!weapon) {
    console.log(`  WARNING: No match for "${block.name}"`)
    continue
  }
  matched++

  if (weapon.name !== block.name) {
    nameUpdates.push({ id: weapon.id, old: weapon.name, new: block.name })
  }

  // Build descriptions array (9 entries, index 0 = tier 1)
  const descriptions = new Array(9).fill('')
  for (const t of block.tiers) {
    descriptions[t.tier - 1] = t.desc
  }

  output.push({
    id: weapon.id,
    name: block.name,
    buffEntryName: block.buffEntryName,
    descriptions
  })
}

console.log(`Matched: ${matched}/${weaponBlocks.length}`)

// ── Step 3: Write output ──
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8')
console.log(`Wrote ${output.length} entries to weaponBuffTiers.json`)

// ── Step 4: Update gamedata names ──
if (nameUpdates.length > 0) {
  console.log('\n=== Weapon NAME changes ===')
  for (const u of nameUpdates) {
    console.log(`  ${u.id}: "${u.old}" → "${u.new}"`)
    const w = weapons.find(w => w.id === u.id)
    if (w) w.name = u.new
  }
  fs.writeFileSync(GAMEDATA_PATH, JSON.stringify(gamedata, null, 2), 'utf-8')
  console.log(`Updated gamedata.json`)
}

// ── Step 5: Quick sanity check ──
const sample = output.find(e => e.name === '熔铸火焰')
if (sample) {
  console.log('\n=== Sample: 熔铸火焰 ===')
  console.log('Tier 1:', sample.descriptions[0])
  console.log('Tier 9:', sample.descriptions[8])
}
