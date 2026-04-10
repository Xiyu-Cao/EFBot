#!/usr/bin/env node
// Generate per-operator static data folders from existing data sources.
// Re-running overwrites all generated files.
// Usage: node scripts/generate-operator-data.js

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'src/data/operators')
const GAMEDATA_PATH = path.join(ROOT, 'public/gamedata.json')
const WIKI_INDEX_PATH = path.join(ROOT, 'src/external-data/warfarin-wiki/operators/index.json')
const WIKI_NORM_DIR = path.join(ROOT, 'src/external-data/warfarin-wiki/operators/normalized')
const AVATARS_DIR = path.join(ROOT, 'public/avatars')

// ── Load sources ──
const gamedata = JSON.parse(fs.readFileSync(GAMEDATA_PATH, 'utf8'))
const wikiIndex = JSON.parse(fs.readFileSync(WIKI_INDEX_PATH, 'utf8'))

function loadWikiNormalized(slug) {
  const p = path.join(WIKI_NORM_DIR, `${slug}.json`)
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

// ── Mappings ──
const STAT_NAME_MAP = { '力量': 'strength', '敏捷': 'agility', '智识': 'intellect', '意志': 'will', '攻击力': 'attack', '生命值': 'hp' }
const PROFESSION_MAP = { '近卫': 'guard', '术师': 'caster', '先锋': 'pioneer', '突击': 'vanguard', '重装': 'defender', '狙击': 'sniper', '辅助': 'support', '医疗': 'medic', '术士': 'caster' }
const ELEMENT_MAP = { 'physical': 'physical', '物理': 'physical', 'blaze': 'blaze', '灼热': 'blaze', 'cold': 'cold', '寒冷': 'cold', 'emag': 'emag', '电磁': 'emag', 'nature': 'nature', '自然': 'nature' }
const ELEMENT_LABEL = { physical: '物理', blaze: '灼热', cold: '寒冷', emag: '电磁', nature: '自然' }
const ATTR_LABEL = { strength: '力量', agility: '敏捷', intellect: '智识', will: '意志' }
const ATTR_KEY_MAP = { '力量': 'strength', '敏捷': 'agility', '智识': 'intellect', '意志': 'will' }
const ATTR_ICON = { strength: '/icons/icon_attribute_str.webp', agility: '/icons/icon_attribute_agi.webp', intellect: '/icons/icon_attribute_wisd.webp', will: '/icons/icon_attribute_will.webp' }
const SKILL_TYPE_MAP = { '普通攻击': 'attack', '战技': 'skill', '连携技': 'link', '终结技': 'ultimate' }

const PROMO_CAPS = [20, 40, 60, 80, 90]
const SKILL_CAPS = [1, 3, 6, 9, 12]

// ── Discover talent icons ──
function findTalentIcons(operatorId) {
  const dir = path.join(AVATARS_DIR, operatorId)
  if (!fs.existsSync(dir)) return [null, null]
  const files = fs.readdirSync(dir).filter(f => f.startsWith('icon_talent_')).sort()
  return [
    files[0] ? `/avatars/${operatorId}/${files[0]}` : null,
    files[1] ? `/avatars/${operatorId}/${files[1]}` : null,
  ]
}

// ── Talent parsing (same logic as AbilityExpansionOverlay) ──
function parseTalentEntries(rawArr) {
  if (!rawArr?.length) return []
  const text = rawArr.join('')
  const entries = []

  // Pass 1: 默认解锁
  const defaultRe = /(?:^|。|\n)([^。\n]*?)默认解锁/g
  let dm
  while ((dm = defaultRe.exec(text)) !== null) {
    const name = dm[1].trim()
    if (name && !entries.find(e => e.name === name)) {
      entries.push({ name, unlockStage: 1, upgradeStage: 2, defaultUnlock: true, stages: [] })
    }
  }

  // Pass 2: 突破X阶段后可解锁/效果提升
  const re = /(?:^|。|\n)([^。\n]*?)突破(\d)阶段后(可解锁|效果提升)(.*?)(?=(?:[^。\n]*?突破\d阶段后)|$)/gs
  let m
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim()
    const stage = parseInt(m[2], 10)
    const type = m[3]
    const desc = m[4]?.trim()?.replace(/。$/, '') || ''
    if (!name) continue
    let entry = entries.find(e => e.name === name)
    if (!entry) {
      entry = { name, unlockStage: null, upgradeStage: null, defaultUnlock: false, stages: [] }
      entries.push(entry)
    }
    if (type === '可解锁' && entry.unlockStage === null) entry.unlockStage = stage
    else if (type === '效果提升' && entry.upgradeStage === null) entry.upgradeStage = stage
    entry.stages.push({ promotion: stage, type: type === '可解锁' ? 'unlock' : 'upgrade', description: desc })
  }

  // For 默认解锁 talents, extract the default description and upgrade descriptions
  for (const entry of entries) {
    if (entry.defaultUnlock && entry.stages.length === 0) {
      // Try to extract default description
      const defRe = new RegExp(entry.name + '默认解锁(.*?)(?=' + entry.name + '突破|$)', 's')
      const defMatch = text.match(defRe)
      if (defMatch) {
        const defDesc = defMatch[1].trim().replace(/。$/, '')
        entry.stages.unshift({ promotion: 0, type: 'default', description: defDesc })
      }
      // Extract upgrades
      const upgRe = new RegExp(entry.name + '突破(\\d)阶段后效果提升(.*?)(?=' + entry.name + '突破|[^。\\n]*?突破\\d阶段后|$)', 'gs')
      let um
      while ((um = upgRe.exec(text)) !== null) {
        entry.stages.push({ promotion: parseInt(um[1], 10), type: 'upgrade', description: um[2].trim().replace(/。$/, '') })
      }
    }
  }

  return entries
}

// ── Generate files for one operator ──
function generateOperator(char, wiki) {
  const id = char.id
  const dir = path.join(OUT_DIR, id)
  fs.mkdirSync(dir, { recursive: true })

  const wikiMeta = wiki?.meta || {}
  const elementKey = ELEMENT_MAP[char.element] || ELEMENT_MAP[wikiMeta.element] || char.element || 'physical'
  const profKey = PROFESSION_MAP[wikiMeta.profession] || wikiMeta.profession || 'unknown'
  const mainAttrKey = ATTR_KEY_MAP[wikiMeta.main_attribute] || null
  const subAttrKey = ATTR_KEY_MAP[wikiMeta.sub_attribute] || null
  const [talentIcon1, talentIcon2] = findTalentIcons(id)

  // ── meta.json ──
  const meta = {
    id,
    slug: wiki?.slug || id.toLowerCase(),
    name: char.name || wiki?.name_zh || id,
    nameEn: wiki?.name_en || '',
    rarity: char.rarity || wikiMeta.rarity || 1,
    profession: profKey,
    professionLabel: wikiMeta.profession || '',
    element: elementKey,
    elementLabel: ELEMENT_LABEL[elementKey] || '',
    weaponType: char.weapon || '',
    weaponTypeLabel: wikiMeta.weapon_type || '',
    mainAttribute: mainAttrKey || '',
    mainAttributeLabel: wikiMeta.main_attribute || '',
    subAttribute: subAttrKey || '',
    subAttributeLabel: wikiMeta.sub_attribute || '',
    avatar: char.avatar || `/avatars/${id}/${id}.webp`,
    icons: {
      skill: char.skill_icon || '',
      link: char.link_icon || '',
      ultimate: char.ultimate_icon || '',
      talent1: talentIcon1 || '',
      talent2: talentIcon2 || '',
    },
  }
  writeJson(dir, 'meta.json', meta)

  // ── stats.json ──
  const levels = {}
  const table1 = wiki?.stats?.tables?.[1]
  if (table1 && table1.length > 1) {
    const hdr = table1[0].slice(1)
    for (let i = 0; i < hdr.length; i++) {
      const lvl = hdr[i]
      levels[lvl] = {}
      for (let r = 1; r < table1.length; r++) {
        const key = STAT_NAME_MAP[table1[r][0]]
        if (key) levels[lvl][key] = parseInt(table1[r][i + 1]) || 0
      }
    }
  }
  writeJson(dir, 'stats.json', {
    _doc: 'Per-level base attributes. Key = character level (1-90). Queried by resolveBaseStats().',
    promotionCaps: PROMO_CAPS,
    levels,
  })

  // ── skills.json ──
  const skillsOut = {
    _doc: 'Skill static definitions. Level data uses unified index 0-11 (RANK1-9 + M1-M3).',
  }
  const wikiSkills = wiki?.skills || []
  const skillIconMap = { attack: char.skill_icon || '', skill: char.skill_icon || '', link: char.link_icon || '', ultimate: char.ultimate_icon || '' }

  for (const ws of wikiSkills) {
    const typeKey = SKILL_TYPE_MAP[ws.type]
    if (!typeKey) continue
    skillsOut[typeKey] = {
      id: typeKey,
      name: ws.name || '',
      type: typeKey,
      icon: skillIconMap[typeKey] || '',
      description: (ws.descriptions || []).join('\n'),
      levelHeaders: ws.level_headers || [],
      levelData: (ws.data_rows || []).map(row => ({ label: row.label || '', values: row.values || [] })),
    }
  }
  // Ensure all 4 keys exist
  for (const k of ['attack', 'skill', 'link', 'ultimate']) {
    if (!skillsOut[k]) skillsOut[k] = { id: k, name: '', type: k, icon: skillIconMap[k], description: '', levelHeaders: [], levelData: [] }
  }
  writeJson(dir, 'skills.json', skillsOut)

  // ── talents.json ──
  const talentEntries = wiki ? parseTalentEntries(wiki.talents) : []
  const talentsArr = talentEntries.map((e, i) => {
    const t = {
      id: `talent_${i}`,
      name: e.name,
      icon: i === 0 ? (talentIcon1 || '') : (talentIcon2 || ''),
      unlockStage: e.unlockStage ?? (i + 1),
      upgradeStage: e.upgradeStage ?? (e.unlockStage ?? i + 1) + 1,
      stages: e.stages || [],
    }
    if (e.defaultUnlock) t.defaultUnlock = true
    return t
  })

  const exclusiveBuffs = (char.exclusive_buffs || []).map(b => ({
    key: b.key || '',
    name: b.name || '',
    icon: b.path || '',
  }))

  writeJson(dir, 'talents.json', {
    _doc: 'Main attribute + talent definitions.',
    mainAttribute: mainAttrKey ? { key: mainAttrKey, label: ATTR_LABEL[mainAttrKey] || '', icon: ATTR_ICON[mainAttrKey] || '' } : null,
    subAttribute: subAttrKey ? { key: subAttrKey, label: ATTR_LABEL[subAttrKey] || '', icon: ATTR_ICON[subAttrKey] || '' } : null,
    talents: talentsArr,
    exclusiveBuffs,
  })

  // ── ability-expansion.json ──
  const unlockMap = {}
  for (const t of talentsArr) {
    const stage = t.defaultUnlock ? 0 : (t.unlockStage ?? 1)
    if (!unlockMap[stage]) unlockMap[stage] = []
    unlockMap[stage].push(t.id)
  }
  writeJson(dir, 'ability-expansion.json', {
    _doc: 'Ability expansion static rules.',
    promotionStages: PROMO_CAPS.map((maxLevel, i) => ({
      promotion: i,
      maxLevel,
      skillCap: SKILL_CAPS[i],
      unlocks: unlockMap[i] || [],
    })),
  })

  return { id, name: char.name, levelsCount: Object.keys(levels).length, talentCount: talentsArr.length, skillCount: Object.keys(skillsOut).filter(k => k !== '_doc').length }
}

function writeJson(dir, filename, data) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2) + '\n')
}

// ── Main ──
function main() {
  console.log('Generating operator static data...\n')
  const results = []
  const warnings = []

  for (const char of gamedata.characterRoster) {
    // Find wiki entry by name match (handles ID mismatches)
    const wikiEntry = wikiIndex.find(w => w.name_zh === char.name || w.id === char.id)
    const slug = wikiEntry?.slug
    const wiki = slug ? loadWikiNormalized(slug) : null

    if (!wiki) warnings.push(`${char.id} (${char.name}): no wiki data, generating with gamedata only`)

    const result = generateOperator(char, wiki)
    results.push(result)
    console.log(`  ${result.id.padEnd(16)} ${result.name.padEnd(6)} levels=${result.levelsCount} skills=${result.skillCount} talents=${result.talentCount}`)
  }

  console.log(`\nGenerated ${results.length} operators in ${OUT_DIR}`)
  if (warnings.length) {
    console.log('\nWarnings:')
    for (const w of warnings) console.log(`  ⚠ ${w}`)
  }
  console.log('\nDone.')
}

main()
