# 把 tools/chart-data.json(由 extract-chart.mjs 產生)逐項對照 Swiss Ephemeris。
# 用法:pip install pyswisseph && python tools/crosscheck.py
import json, datetime as dt, os
import swisseph as swe

HERE = os.path.dirname(os.path.abspath(__file__))

swe.set_sid_mode(swe.SIDM_LAHIRI, 0, 0)

BODIES = {'Sun': swe.SUN, 'Moon': swe.MOON, 'Mars': swe.MARS, 'Mercury': swe.MERCURY,
          'Jupiter': swe.JUPITER, 'Venus': swe.VENUS, 'Saturn': swe.SATURN,
          'Rahu': swe.MEAN_NODE}

FLAGS = swe.FLG_SWIEPH | swe.FLG_SIDEREAL | swe.FLG_SPEED

def jd_ut(iso):
    d = dt.datetime.fromisoformat(iso.replace('Z', '+00:00'))
    h = d.hour + d.minute/60 + d.second/3600
    return swe.julday(d.year, d.month, d.day, h, swe.GREG_CAL)

def arcsec(a, b):
    d = (a - b + 180) % 360 - 180
    return d * 3600

rows = []
worst = {}
for c in json.load(open(os.path.join(HERE, 'chart-data.json'))):
    jd = jd_ut(c['iso'])
    ay_swe = swe.get_ayanamsa_ut(jd)
    rows.append((c['label'], 'Ayanāṁśa', c['ayanamsa'], ay_swe, arcsec(c['ayanamsa'], ay_swe), ''))
    for name, code in BODIES.items():
        pos, _ = swe.calc_ut(jd, code, FLAGS)
        lon_swe, speed = pos[0], pos[3]
        lon_tool = c['planets'][name]
        d = arcsec(lon_tool, lon_swe)
        note = ''
        if name not in ('Rahu',):
            retro_swe = speed < 0
            if retro_swe != c['retro'][name]:
                note = f'逆行判定不符(swe={retro_swe}, tool={c["retro"][name]})'
        rows.append((c['label'], name, lon_tool, lon_swe, d, note))
        worst[name] = max(worst.get(name, 0), abs(d))
    # Ketu
    ketu_swe = (swe.calc_ut(jd, swe.MEAN_NODE, FLAGS)[0][0] + 180) % 360
    rows.append((c['label'], 'Ketu', c['planets']['Ketu'], ketu_swe, arcsec(c['planets']['Ketu'], ketu_swe), ''))
    # Ascendant (whole sign / any house system gives same asc)
    cusps, ascmc = swe.houses_ex(jd, c['lat'], c['lon'], b'W', swe.FLG_SIDEREAL)
    asc_swe = ascmc[0]
    d = arcsec(c['asc'], asc_swe)
    rows.append((c['label'], 'Ascendant', c['asc'], asc_swe, d, ''))
    worst['Ascendant'] = max(worst.get('Ascendant', 0), abs(d))
    worst['Ayanāṁśa'] = max(worst.get('Ayanāṁśa', 0), abs(arcsec(c['ayanamsa'], ay_swe)))
    worst['Ketu'] = max(worst.get('Ketu', 0), abs(arcsec(c['planets']['Ketu'], ketu_swe)))

print(f"{'案例':<26}{'項目':<12}{'工具':>12}{'SwissEph':>12}{'差(角秒)':>12}  備註")
print('-' * 92)
last = None
for label, name, a, b, d, note in rows:
    if label != last:
        print()
        last = label
    flag = '  ⚠' if abs(d) > 12 else ''
    print(f"{label:<26}{name:<12}{a:12.5f}{b:12.5f}{d:12.2f}{flag}  {note}")

print('\n=== 各項最大誤差(角秒) ===')
for k, v in sorted(worst.items(), key=lambda x: -x[1]):
    print(f"  {k:<12}{v:9.2f}{'   ⚠ 超過 README 記錄的 12″ 基準' if v > 12 else ''}")
