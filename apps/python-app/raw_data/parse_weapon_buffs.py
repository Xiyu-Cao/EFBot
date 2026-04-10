"""
parse_weapon_buffs.py
从终末地武器数据.xlsx 的武器词条③解析 passiveStats 和 triggeredBuffs，
写入 data_engine/equipment.json 和 endaxis-web/public/gamedata.json
"""
import re, json, os, sys
import openpyxl

sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)

# ── 属性名映射 ────────────────────────────────────────────────────────────────
STAT_MAP = {
    '普通攻击伤害':     ('attack_dmg_bonus',    '增伤'),
    '战技伤害':         ('skill_dmg_bonus',      '增伤'),
    '连携技伤害':       ('link_dmg_bonus',       '增伤'),
    '终结技伤害':       ('ultimate_dmg_bonus',   '增伤'),
    '所有技能伤害':     ('all_skill_dmg_bonus',  '增伤'),
    '灼热和自然伤害':   ('blaze_nature_dmg',     '增伤'),
    '灼热和电磁伤害':   ('blaze_emag_dmg',       '增伤'),
    '寒冷和自然伤害':   ('cold_nature_dmg',      '增伤'),
    '物理和电磁伤害':   ('physical_emag_dmg',    '增伤'),
    '法术伤害':         ('arts_dmg',             '增伤'),
    '物理伤害':         ('physical_dmg',         '增伤'),
    '灼热伤害':         ('blaze_dmg',            '增伤'),
    '电磁伤害':         ('emag_dmg',             '增伤'),
    '寒冷伤害':         ('cold_dmg',             '增伤'),
    '自然伤害':         ('nature_dmg',           '增伤'),
    '攻击力':           ('attack',               '攻击加成'),
    '暴击率':           ('crit_rate',            '暴击'),
    '暴击伤害':         ('crit_dmg',             '暴击'),
    '最大生命值':       ('hp',                   '角色属性'),
    '生命值':           ('hp',                   '角色属性'),
    '防御力':           ('defense',              '角色属性'),
    '治疗效率':         ('healing_effect',       '治疗'),
    '源石技艺强度':     ('originium_arts_power', '特殊系数'),
    '主能力':           ('primary_ability',      '角色属性'),
    '副能力':           ('secondary_ability',    '角色属性'),
    '全能力':           ('all_ability',          '角色属性'),
    '护盾效果':         ('shield_effect',        '治疗'),
    '失衡值':           ('stagger_value',        '特殊'),
    '物理脆弱':         ('physical_fragile',     '脆弱'),
    '法术脆弱':         ('arts_fragile',         '脆弱'),
    '对应属性的伤害':   ('element_dmg',          '易伤'),
    '对应属性':         ('element_dmg',          '易伤'),
}

# ── 触发条件映射（按优先级从长到短排列）──────────────────────────────────────
TRIGGER_MAP = [
    (r'通过自身战技施加法术异常时',             'on_skill_arts_anomaly_apply'),
    (r'通过自身战技施加破防时',                 'on_skill_break_apply'),
    (r'通过自身战技施加寒冷附着时',             'on_skill_cold_attach'),
    (r'通过自身战技施加自然附着时',             'on_skill_nature_attach'),
    (r'通过自身战技施加物理脆弱时',             'on_skill_physical_fragile'),
    (r'通过自身战技治疗后',                     'on_skill_heal'),
    (r'通过自身连携技造成击飞后',               'on_link_knockup'),
    (r'通过自身连携技造成法术爆发或物理异常时', 'on_link_burst_or_physical_anomaly'),
    (r'通过自身连携技治疗后',                   'on_link_heal'),
    (r'通过自身技能恢复技力或获得连击状态后',   'on_skill_sp_restore_or_combo'),
    (r'通过自身技能恢复技力后',                 'on_skill_sp_restore'),
    (r'通过自身技能治疗后',                     'on_skill_heal'),
    (r'通过自身技能施加破防时',                 'on_skill_break_apply'),
    (r'战技和终结技命中敌人时',                 'on_skill_or_ultimate_hit'),
    (r'战技或终结技命中敌人时',                 'on_skill_or_ultimate_hit'),
    (r'战技或终结技施加寒冷附着时',             'on_skill_or_ultimate_cold_attach'),
    (r'战技或连携技造成暴击伤害后',             'on_skill_or_link_crit'),
    (r'战技命中敌人时',                         'on_skill_hit'),
    (r'通过自身战技',                           'on_skill'),
    (r'通过自身连携技',                         'on_link'),
    (r'施放终结技时',                           'on_ultimate'),
    (r'施放战技时',                             'on_skill'),
    (r'施放连携技时',                           'on_link'),
    (r'对没有破防层数的敌人施加破防时',         'on_break_apply_no_existing'),
    (r'消耗破防层数后',                         'on_break_consume'),
    (r'通过技能施加破防时',                     'on_skill_break_apply'),
    (r'施加破防时',                             'on_break_apply'),
    (r'消耗法术异常后',                         'on_arts_anomaly_consume'),
    (r'消耗法术附着后',                         'on_arts_attach_consume'),
    (r'消耗腐蚀后',                             'on_corrosion_consume'),
    (r'消耗冻结后',                             'on_freeze_consume'),
    (r'施加导电时',                             'on_conductive_apply'),
    (r'施加燃烧或导电后',                       'on_burning_or_conductive_apply'),
    (r'施加源石结晶或冻结时',                   'on_crystal_or_freeze_apply'),
    (r'施加法术异常时',                         'on_arts_anomaly_apply'),
    (r'施加燃烧时',                             'on_burning_apply'),
    (r'施加自然附着时',                         'on_nature_attach'),
    (r'施加冻结时',                             'on_freeze_apply'),
    (r'施加腐蚀时',                             'on_corrosion_apply'),
    (r'造成法术爆发时',                         'on_arts_burst'),
    (r'造成物理异常(?:时|后)',                   'on_physical_anomaly'),
    (r'造成重击时',                             'on_heavy_attack'),
    (r'造成击飞后',                             'on_knockup'),
    (r'造成倒地或施加虚弱时',                   'on_knockdown_or_weaken'),
    (r'处于庇护状态的干员受到伤害后',           'on_shielded_ally_damaged'),
    (r'场上有敌人被施加冻结或腐蚀时',           'condition_freeze_or_corrosion_on_field'),
    (r'当装备者的生命值高于80%时',              'condition_hp_above_80pct'),
]

# ── 目标映射 ──────────────────────────────────────────────────────────────────
def detect_target(text):
    if re.search(r'全队|小队内[所有]*干员(?!其他)', text):
        return 'team'
    if re.search(r'小队内其他干员|全队内其他', text):
        return 'others'
    if re.search(r'主控干员', text):
        return 'main_operator'
    if re.search(r'(?:使|令)(?:目标)?敌人受到|目标敌人', text):
        return 'enemy'
    return 'self'

# ── 提取单句中的属性加成 ──────────────────────────────────────────────────────
def extract_effects(text):
    effects = []
    # 优先匹配长名称（避免"法术伤害"匹配到"物理伤害"后面的"法术"）
    sorted_stats = sorted(STAT_MAP.keys(), key=len, reverse=True)
    for stat_name in sorted_stats:
        stat_id, zone = STAT_MAP[stat_name]
        # 百分比
        m = re.search(re.escape(stat_name) + r'[+＋](\d+\.?\d*)%', text)
        if m:
            effects.append({'stat': stat_id, 'value': float(m.group(1)), 'zone': zone, 'unit': 'percent'})
            continue
        # 整数（源石技艺强度等）
        m = re.search(re.escape(stat_name) + r'[+＋](\d+)', text)
        if m:
            effects.append({'stat': stat_id, 'value': int(m.group(1)), 'zone': zone, 'unit': 'flat'})
    return effects

# ── 提取持续时间 ──────────────────────────────────────────────────────────────
def extract_duration(text):
    m = re.search(r'持续(\d+\.?\d*)秒', text)
    return float(m.group(1)) if m else None

# ── 提取叠层信息 ──────────────────────────────────────────────────────────────
def extract_stack_info(full_text):
    max_stacks = 1
    stack_cooldown = None
    m = re.search(r'最多叠加(\d+)层', full_text)
    if m:
        max_stacks = int(m.group(1))
    m = re.search(r'每(\d+\.?\d*)秒最多触发一次', full_text)
    if m:
        stack_cooldown = float(m.group(1))
    return max_stacks, stack_cooldown

# ── 主解析函数 ────────────────────────────────────────────────────────────────
def parse_buff(buff_text, buff_name):
    result = {'passiveStats': {}, 'triggeredBuffs': []}
    if not buff_text or str(buff_text).strip() in ('无', '', 'None'):
        return result

    text = str(buff_text).strip()
    # 移除【...】头部标签
    text_no_header = re.sub(r'^【[^】]*】', '', text).strip()

    max_stacks, stack_cooldown = extract_stack_info(text_no_header)

    # 分句（按句号，过滤空句和元信息句）
    raw_sentences = [s.strip() for s in re.split(r'。', text_no_header) if s.strip()]
    meta_prefixes = ('同名效果', '两种效果', '每种效果', '该效果每', '每0.', '每有一个', '若装备者为主控')
    sentences = [s for s in raw_sentences if not any(s.startswith(p) for p in meta_prefixes)]

    triggered_keywords = ['时，', '后，', '时,', '后,']

    for sent in sentences:
        is_triggered = any(kw in sent for kw in triggered_keywords)

        if not is_triggered:
            # 被动属性
            effects = extract_effects(sent)
            for e in effects:
                key = e['stat']
                val = e['value']
                result['passiveStats'][key] = result['passiveStats'].get(key, 0) + val
            if not effects:
                result['passiveStats']['_raw'] = sent
        else:
            # 触发buff：先识别触发条件
            trigger = '_unknown'
            for pattern, trig_id in TRIGGER_MAP:
                if re.search(pattern, sent):
                    trigger = trig_id
                    break

            target = detect_target(sent)
            effects = extract_effects(sent)
            duration = extract_duration(sent)

            entry = {
                'trigger': trigger,
                'name': buff_name,
                'target': target,
                'effects': effects,
                'duration': duration,
                'maxStacks': max_stacks,
            }
            if stack_cooldown:
                entry['stackCooldown'] = stack_cooldown
            if not effects:
                entry['_raw'] = sent
            result['triggeredBuffs'].append(entry)

    return result


# ── 读取 Excel ────────────────────────────────────────────────────────────────
DATA_DIR = os.path.dirname(os.path.abspath(__file__))
wb = openpyxl.load_workbook(os.path.join(DATA_DIR, '终末地武器数据.xlsx'), read_only=True, data_only=True)
ws = wb['终末地武器数据']
rows = list(ws.iter_rows(values_only=True))
wb.close()
headers = [str(h).strip() for h in rows[0]]

# 建立 id -> (buffName, buffText) 映射
raw_map = {}
for row in rows[1:]:
    if all(v is None for v in row): continue
    d = {headers[i]: row[i] for i in range(len(headers))}
    wid = d.get('武器ID')
    if wid:
        raw_map[str(wid)] = {
            'buffName': d.get('武器名称', ''),   # 临时用武器名，buffName 已在 equipment.json
            'buffText': d.get('武器词条③', ''),
        }

# ── 第一步：更新 gamedata.json（endaxis 为唯一数据源）────────────────────────
GD_PATH = os.path.join(DATA_DIR, '..', '..', '..', 'apps', 'endaxis-web', 'public', 'gamedata.json')
if not os.path.exists(GD_PATH):
    GD_PATH = os.path.join(DATA_DIR, '..', '..', 'endaxis-web', 'public', 'gamedata.json')
with open(GD_PATH, 'r', encoding='utf-8') as f:
    gd = json.load(f)

parse_errors = []
for w in gd['weaponDatabase']:
    raw = raw_map.get(w['id'])
    if not raw:
        continue
    parsed = parse_buff(raw['buffText'], w.get('buffName', ''))
    w['passiveStats'] = parsed['passiveStats']
    w['triggeredBuffs'] = parsed['triggeredBuffs']
    # 检查是否有未解析字段
    if '_raw' in parsed['passiveStats'] or any('_raw' in b for b in parsed['triggeredBuffs']):
        parse_errors.append(w['name'])

with open(GD_PATH, 'w', encoding='utf-8') as f:
    json.dump(gd, f, ensure_ascii=False, indent=2)
print(f'gamedata.json 更新完成，{len(gd["weaponDatabase"])} 件武器')

# ── 第二步：从 gamedata.json 同步到 equipment.json（以 endaxis 为准）─────────
EQ_PATH = os.path.join(DATA_DIR, '..', 'data_engine', 'equipment.json')
with open(EQ_PATH, 'r', encoding='utf-8') as f:
    eq = json.load(f)

gd_weapon_map = {w['id']: w for w in gd['weaponDatabase']}
for w in eq['weapons']:
    gd_w = gd_weapon_map.get(w['id'])
    if not gd_w:
        continue
    w['passiveStats'] = gd_w.get('passiveStats', {})
    w['triggeredBuffs'] = gd_w.get('triggeredBuffs', [])

with open(EQ_PATH, 'w', encoding='utf-8') as f:
    json.dump(eq, f, ensure_ascii=False, indent=2)
print(f'equipment.json 已从 gamedata.json 同步，{len(eq["weapons"])} 件武器')

print()
if parse_errors:
    print(f'以下 {len(parse_errors)} 件武器有未完全解析的字段（含 _raw），需手动核查：')
    for name in parse_errors:
        print(f'  - {name}')
else:
    print('所有武器解析完成，无需手动核查。')
