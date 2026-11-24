"""SutonnyMJ (Bijoy ANSI) → Unicode বাংলা। ফর্মের লেখা পড়ার জন্য যথেষ্ট, নিখুঁত নয়।"""
import re

PRE_E, PRE_I, PRE_OI = '', '', ''   # সামনে বসা কার (পরে সরানো হয়)
REPH = ''

MULTI = [
    ('i¨', 'র‌্য'), ('ª¨', '্র্য'), ('Av', 'আ'),
]
SINGLE = {
    'A': 'অ', 'B': 'ই', 'C': 'ঈ', 'D': 'উ', 'E': 'ঊ', 'F': 'ঋ', 'G': 'এ', 'H': 'ঐ', 'I': 'ও', 'J': 'ঔ',
    'K': 'ক', 'L': 'খ', 'M': 'গ', 'N': 'ঘ', 'O': 'ঙ', 'P': 'চ', 'Q': 'ছ', 'R': 'জ', 'S': 'ঝ', 'T': 'ঞ',
    'U': 'ট', 'V': 'ঠ', 'W': 'ড', 'X': 'ঢ', 'Y': 'ণ', 'Z': 'ত', '_': 'থ', '`': 'দ', 'a': 'ধ', 'b': 'ন',
    'c': 'প', 'd': 'ফ', 'e': 'ব', 'f': 'ভ', 'g': 'ম', 'h': 'য', 'i': 'র', 'j': 'ল', 'k': 'শ', 'l': 'ষ',
    'm': 'স', 'n': 'হ', 'o': '\u09dc', 'p': '\u09dd', 'q': '\u09df', 'r': 'ৎ', 's': 'ং', 't': 'ঃ', 'u': 'ঁ',
    'v': 'া', 'x': 'ী', 'y': 'ু', 'z': 'ু', '~': 'ূ', 'æ': 'ু', '„': 'ৃ', '…': 'ৃ', 'Š': 'ৗ',
    'w': PRE_I, '‡': PRE_E, '†': PRE_E, 'ˆ': PRE_OI, '‰': PRE_OI,
    '&': '্', '|': '।', 'Ô': '‘', 'Õ': '’', 'Ò': '“', 'Ó': '”',
    '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪', '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
    '¨': '্য', 'Ö': '্র', 'ª': '্র', '«': '্র', '©': REPH, '^': '্ব', '¡': '্ব', 'œ': '্ন', 'ø': '্ল', '¬': '্ল',
    'ú': '্প', '‹': '্ক', '’': '্থ', 'Í': '্ত',
    'š': 'ন', '¯': 'স', '¤': 'ম', '›': 'ন',   # অর্ধ-রূপ; পরের চিহ্ন ্ যোগ করে
    'ÿ': 'ক্ষ', '³': 'ক্ত', 'µ': 'ক্র', 'Ë': 'ত্ত', '×': 'দ্ধ', 'Î': 'ত্র', 'ô': 'ষ্ঠ', 'ó': 'ষ্ট', 'ß': 'প্ত',
    'Ø': 'দ্ব', '§': 'ম্ম', 'í': 'ল্প', 'Á': 'জ্ঞ', 'Û': 'ন্ড', 'Ü': 'ন্ধ', 'Ý': 'ন্ম', 'Æ': 'ট্ট', '÷': 'ঙ্গ',
    '±': 'ক্ল', '·': 'ক্স', '¥': '্ম', '¿': 'গ্ন', 'ï': 'শু', 'å': 'ষ্ণ', 'ë': 'দ্ম', 'Â': 'জ্জ', '¦': 'ন্দ',
    '°': 'ক্ক', 'Ÿ': 'ড্ড', '¸': 'ঙ্গ',
}
HALF = set('š¯¤›')
CONS = set('কখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহৎ\u09dc\u09dd\u09df')


def _sub(s):
    for a, b in MULTI:
        s = s.replace(a, b)
    out = []
    for ch in s:
        if ch in HALF:
            out.append(SINGLE[ch] + '্')
        else:
            out.append(SINGLE.get(ch, ch))
    s = ''.join(out)
    s = s.replace('্্', '্')
    return s


def _cluster_end(s, i):
    """i থেকে শুরু হওয়া যুক্তবর্ণের শেষ (বাদে)।"""
    if i >= len(s) or s[i] not in CONS:
        return i
    j = i + 1
    while j + 1 < len(s) and s[j] == '্' and s[j + 1] in CONS:
        j += 2
    return j


def _cluster_start(s, j):
    """j তে শেষ হওয়া (বাদে) যুক্তবর্ণের শুরু।"""
    i = j - 1
    if i < 0 or s[i] not in CONS:
        return j
    while i - 2 >= 0 and s[i - 1] == '্' and s[i - 2] in CONS:
        i -= 2
    return i


def convert(t):
    s = _sub(t)
    # রেফ: আগের যুক্তবর্ণের (ও তার আগের সামনে-কারের) আগে
    while REPH in s:
        k = s.index(REPH)
        j = k
        # মাঝে থাকা পেছনের কার (া ী ু ূ ৃ) টপকে
        while j > 0 and s[j - 1] in 'াীুূৃ':
            j -= 1
        st = _cluster_start(s, j)
        if st > 0 and s[st - 1] in (PRE_E, PRE_I, PRE_OI):
            st -= 1
        s = s[:st] + 'র্' + s[st:k] + s[k + 1:]
    # সামনে-কার: পরের যুক্তবর্ণের পরে
    out, i = [], 0
    while i < len(s):
        ch = s[i]
        if ch in (PRE_E, PRE_I, PRE_OI):
            j = i + 1
            if j < len(s) and s[j:j + 2] == 'র্':
                e = _cluster_end(s, j + 2)
                cl = s[j:e]
            else:
                e = _cluster_end(s, j)
                cl = s[j:e]
            kar = {PRE_E: 'ে', PRE_I: 'ি', PRE_OI: 'ৈ'}[ch]
            if kar == 'ে' and e < len(s) and s[e] == 'া':
                kar, e = 'ো', e + 1
            elif kar == 'ে' and e < len(s) and s[e] == 'ৗ':
                kar, e = 'ৌ', e + 1
            out.append(cl + kar)
            i = e
        else:
            out.append(ch)
            i += 1
    s = ''.join(out)
    return s


if __name__ == '__main__':
    import sys
    for w in sys.argv[1:]:
        print(w, '→', convert(w))
