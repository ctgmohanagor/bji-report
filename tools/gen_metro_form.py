"""metro_map.py থেকে bji-report/metro_form.js তৈরি: মহানগরের ফর্মের ক্রম + শুধু-মহানগরের ঘরগুলোর সংজ্ঞা (m001…)"""
import json, re, sys
sys.path.insert(0, '.')
from metro_map import MAP, H

FIELDS = {f['key']: f for f in json.load(open('fields_v7b.json'))}
ORDER = list(FIELDS)

def expand(src):
    out, i = [], 0
    while i < len(src):
        k = src[i]
        if k == '…':
            a, b = ORDER.index(src[i - 1]), ORDER.index(src[i + 1])
            out += ORDER[a + 1:b]
        elif k != '+H':
            out.append(k)
        i += 1
    return out

TBT_RE = re.compile(r'উদ্যোক্তা|বিশেষজ্ঞ|অর্থনীতিবিদ')
def spec(label):
    """শুধু-মহানগরের সারির ধরন"""
    if label.startswith('মিডিয়া ('):
        return [('CF', 'মিডিয়া — সদস্য (রুকন)', {}), ('CF', 'মিডিয়া — কর্মী', {}), ('CF', 'মিডিয়া — সহযোগী সদস্য', {})]
    if 'উপজেলা/থানা' in label and ('প্রশাসনিক' in label or 'সংগঠিত' in label or 'সাংগঠনিক' in label): return [('CB', label, {})]
    if label.startswith('এমারত'): return [('CF', label, {})]
    if 'কেন্দ্রীয়/অঞ্চল' in label: return [('N2', label, {'labels': ['কেন্দ্রীয়', 'অঞ্চল']})]
    if 'সফর' in label: return [('N', label, {})]
    if label == 'সেমিনার/সিম্পোজিয়াম': return [('ATT1', label, {})]
    if label in ('সেমিনার/সিম্পোজিয়াম/আলোচনা সভা', 'গোলটেবিল বৈঠক/মতবিনিময়', 'আন্তর্জাতিক ইস্যু', 'শহীদ বুদ্ধিজীবী দিবস'):
        return [('ATT1', label, {'opt': 'hide*:target'})]
    if label.startswith('নির্বাচন:'): return [('ELEC', label, {})]
    if 'নির্বাচন' in label: return [('N4', label, {'labels': ['নির্বাচন', 'মোট পদ সংখ্যা', 'অংশগ্রহণকৃত পদ', 'নির্বাচিত পদ সংখ্যা']})]
    if label.startswith('আইনজীবী জনশক্তি'):
        return [('N', 'আইনজীবী জনশক্তি', {}), ('N', 'আইনি সহায়তা প্রদান', {}), ('N', 'নতুন আইনজীবী তৈরী', {})]
    if TBT_RE.search(label): return [('TBT', label, {})]
    if label.startswith(('আদর্শ শিক্ষা প্রতিষ্ঠান', 'গবেষক', 'গবেষণা')): return [('TT', label, {})]
    if label == 'মন্তব্য': return [('TXT', label, {})]
    if re.search(r'বৈঠক|সম্মেলন|শিক্ষাশিবির|ওরিয়েন্টেশন|শববেদারী', label) and 'মানবসম্পদ' not in label:
        return [('ATT', label, {})]
    return [('N', label, {})]

sections, extra, n, own_only = [], [], 0, []
for title, rows in MAP:
    keys = []
    for label, src in rows:
        if src == H and label.startswith('সামাজিক কাজে মোট আয়ের'):
            keys.append('f251'); own_only.append('f251'); continue
        if src == H:
            for pat, lab, more in spec(label):
                n += 1
                k = 'm%03d' % n
                d = {'key': k, 'pattern': pat, 'label': lab, 'enter': 'X', 'opt': more.get('opt', '')}
                if 'labels' in more: d['labels'] = more['labels']
                extra.append(d); keys.append(k)
            continue
        for k in expand(src):
            if k not in keys: keys.append(k)
    sections.append({'title': title, 'keys': keys})

js = ('/* মহানগরের ষান্মাসিক/বার্ষিক রিপোর্টের ফর্ম (tools: /home/claude/metro/gen_metro_form.py থেকে তৈরি)।\n'
      '   sections: মহানগরের নমুনা ফর্মের ক্রমে অংশ ও ঘর। f… = থানার ফর্মের ঘর (থানার যোগফল + মহানগরের নিজস্ব),\n'
      '   m… = শুধু মহানগরের ঘর (থানার অংশ নেই)। ownOnly: শতাংশ ইত্যাদি, যোগ হয় না — শুধু মহানগরের লেখা। */\n'
      'var METRO_FORM = ' + json.dumps({'sections': sections, 'extra': extra, 'ownOnly': own_only}, ensure_ascii=False, indent=1) + ';\n')
open('/home/claude/bji-report/metro_form.js', 'w', encoding='utf-8').write(js)
print('sections', len(sections), 'keys', sum(len(s['keys']) for s in sections), 'extra', len(extra))
from collections import Counter; print(Counter(e['pattern'] for e in extra))
