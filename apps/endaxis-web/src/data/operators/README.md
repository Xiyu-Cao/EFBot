# Operator Static Data

Each operator gets a folder named by its ID (e.g. `ENDMINISTRATOR/`).

## Directory structure

```
operators/
  <OPERATOR_ID>/
    meta.json              # Identity, profession, element, icons
    stats.json             # Per-level base attributes (1-90)
    skills.json            # Skill definitions + per-level multipliers
    talents.json           # Main/sub attribute, talents, exclusive buffs
    ability-expansion.json # Promotion stage rules, unlock progression
```

## What belongs here (static, never changes at runtime)

- Operator identity and classification
- Base attributes per level
- Skill descriptions and level scaling tables
- Talent descriptions and unlock stages
- Promotion stage rules (level caps, skill caps, unlocks)
- Icon paths / asset references

## What does NOT belong here (lives in track/store)

- Current promotion level
- Current character level
- Current skill levels / mastery
- Current weapon / equipment selection
- Current equipment refine tier
- Computed final stats

## Key conventions

- Field names use stable English keys (`agility`, not `敏捷`)
- Chinese labels stored in separate `*Label` fields when needed
- `stats.json` levels keyed as strings (`"1"` .. `"90"`) for JSON compatibility
- `skills.json` level data indexed 0-11 matching unified level system (RANK1-9 + M1-M3)
- `ability-expansion.json` `skillCap` uses unified scale (1-12)
