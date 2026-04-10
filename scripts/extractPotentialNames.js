const fs = require('fs');
const path = require('path');
const dir = 'E:/EFBot/apps/endaxis-web/src/data/operators';
const gd = JSON.parse(fs.readFileSync('E:/EFBot/apps/endaxis-web/public/gamedata.json','utf-8'));
const roster = gd.characterRoster || [];

const DESC_STARTS = [
  '战技','连携技','终结技','天赋','普通攻击','智识','意志','力量','敏捷',
  '造成','每当','装备','对处','该效','所需','自身','主控',
  '施放','场上','当主','攻击力','暴击','源石','物理','法术',
  '灼热','寒冷','电磁','自然','治疗','生命','受到',
];

const ops = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir,f)).isDirectory());
let updated = 0;
for (const op of ops) {
  const pPath = path.join(dir, op, 'potentials.json');
  if (!fs.existsSync(pPath)) continue;
  const data = JSON.parse(fs.readFileSync(pPath,'utf-8'));
  let changed = false;
  for (const p of (data.potentials || [])) {
    if (p.name) continue;
    const desc = p.description || '';
    // Special: starts with left/right quote
    const quoteRe = /^[\u201c\u201d""](.+?)[\u201c\u201d""](.*)$/;
    const quoteMatch = desc.match(quoteRe);
    if (quoteMatch) {
      p.name = quoteMatch[1];
      p.description = quoteMatch[2];
      changed = true;
      continue;
    }
    // Find earliest keyword position
    let bestPos = desc.length;
    for (const kw of DESC_STARTS) {
      const idx = desc.indexOf(kw);
      if (idx > 0 && idx < bestPos) bestPos = idx;
    }
    if (bestPos > 0 && bestPos <= 8) {
      p.name = desc.substring(0, bestPos);
      p.description = desc.substring(bestPos);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(pPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    updated++;
  }
  const name = roster.find(c => c.id === op)?.name || op;
  for (const p of (data.potentials || [])) {
    console.log(name + ' P' + p.level + ': [' + (p.name||'???') + '] ' + (p.description||'').substring(0, 35));
  }
}
console.log('\nUpdated:', updated, 'files');
