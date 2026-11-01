"""按 _dev/zhuge_sources_spec.json 去抓原典页，生成 _dev/zhuge_sources/*.txt 摘录与 zhuge/sources.json（要联网）。

用法：/opt/Alphie/.venv/bin/python _dev/zhuge_sources_fetch.py [--only 134,87]

spec 每签一条 {n, gist, refs:[{kind, work, page, find, quote_s?, note?}]}：
  page  维基文库页面标题（https://zh.wikisource.org/wiki/<page>）
  find  要在页面原文里找的那段（简体即可，按 OpenCC 简繁归一后比对；标点、空白不计）
抓回的页面去掉 HTML 后，在原文里定位 find，原样截出 quote，并把前后各约 180 字的原文
连同来源 URL、抓取日期写成摘录文件。kind=A 时在 quote 里找签文的某一整句，填 match / match_raw；
找不到整句就报错（应改为 B）；声明 B 却有整句对上也报错（应改为 A）。
离线核对见 _dev/zhuge_sources_check.py。
"""
from __future__ import annotations

import argparse
import datetime
import html.parser
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from zhuge_sources_check import Norm, clauses  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
EX_DIR = ROOT / '_dev/zhuge_sources'
UA = {'User-Agent': 'datode-zhuge-sources/1.0 (https://datode.com/zhuge/)'}
PUNCT = set('，。；：、！？「」『』“”‘’《》〈〉（）()·…—,.;:!? \t\r\n　')
CACHE = Path(os.environ.get('TMPDIR', '/tmp')) / 'zhuge_ws_cache'


class Text(html.parser.HTMLParser):
    BLOCK = {'p', 'div', 'br', 'li', 'tr', 'dd', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'table', 'blockquote', 'center', 'poem'}
    SKIP = {'style', 'script', 'sup'}
    VOID = {'br', 'img', 'hr', 'wbr', 'input', 'meta', 'link', 'source', 'col', 'area'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in self.VOID:
            if tag == 'br' and not self.skip:
                self.out.append('\n')
            return
        cls = dict(attrs).get('class') or ''
        if self.skip or tag in self.SKIP or 'mw-editsection' in cls or 'noprint' in cls:
            self.skip += 1
            return
        if tag in self.BLOCK:
            self.out.append('\n')

    def handle_endtag(self, tag):
        if tag in self.VOID:
            return
        if self.skip:
            self.skip -= 1
            return
        if tag in self.BLOCK:
            self.out.append('\n')

    def handle_data(self, d):
        if not self.skip:
            self.out.append(d)


def page_text(title: str) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (urllib.parse.quote(title, safe='') + '.txt')
    if f.exists():
        return f.read_text(encoding='utf-8')
    u = 'https://zh.wikisource.org/w/api.php?' + urllib.parse.urlencode(
        {'action': 'parse', 'page': title, 'prop': 'text', 'format': 'json', 'formatversion': 2, 'redirects': 1, 'disablelimitreport': 1})
    for k in range(4):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40))
            break
        except Exception:
            if k == 3:
                raise
            time.sleep(2 + k * 3)
    if 'error' in d:
        raise RuntimeError(f'{title}: {d["error"].get("info")}')
    p = Text()
    p.feed(d['parse']['text'])
    t = ''.join(p.out)
    t = re.sub(r'[ \t ]+', ' ', t)
    t = re.sub(r'\n\s*\n+', '\n', t)
    f.write_text(t, encoding='utf-8')
    time.sleep(0.5)
    return t


def locate(text: str, find: str, nm: Norm):
    """在 text 里找 find（不计标点空白、简繁归一），返回 (start, end) 原文下标。"""
    idx = [i for i, c in enumerate(text) if c not in PUNCT]
    hay = [nm.key(text[i]) for i in idx]
    ned = [nm.key(c) for c in find if c not in PUNCT]
    L = len(ned)
    for s in range(len(hay) - L + 1):
        if hay[s:s + L] == ned:
            return idx[s], idx[s + L - 1] + 1
    return None


def excerpt(text: str, a: int, b: int, pad: int = 180) -> str:
    """quote 前后各约 pad 字的原文（跨段照录，段落换行保留）。"""
    return text[max(0, a - pad):min(len(text), b + pad)].strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    only = {int(x) for x in a.only.split(',') if x}
    nm = Norm()
    spec = json.loads((ROOT / '_dev/zhuge_sources_spec.json').read_text(encoding='utf-8'))
    qian = {q['n']: q['text'] for q in json.loads((ROOT / 'zhuge/qian.json').read_text(encoding='utf-8'))['qian']}
    out_path = ROOT / 'zhuge/sources.json'
    prev = {e['n']: e for e in json.loads(out_path.read_text(encoding='utf-8'))['entries']} if out_path.exists() else {}
    today = datetime.date.today().isoformat()
    EX_DIR.mkdir(parents=True, exist_ok=True)
    entries, bad = [], 0
    for e in spec['entries']:
        n = e['n']
        if only and n not in only and n in prev:
            entries.append(prev[n])
            continue
        refs = []
        for k, r in enumerate(e.get('refs', []), 1):
            url = 'https://zh.wikisource.org/wiki/' + urllib.parse.quote(r['page'].replace(' ', '_'), safe='/()')
            try:
                t = page_text(r['page'])
            except Exception as ex:
                print(f'FAIL {n} {r["work"]}: 抓取失败 {ex}')
                bad += 1
                continue
            span = locate(t, r['find'], nm)
            if not span:
                print(f'FAIL {n} {r["work"]}: 页面里找不到「{r["find"]}」')
                bad += 1
                continue
            quote = re.sub(r'\s', '', t[span[0]:span[1]])
            if re.search(r'一作|[〈〉*\[\]【】]', quote):
                print(f'FAIL {n} {r["work"]}: quote 夹着校注「{quote}」，换一个页面或截短')
                bad += 1
                continue
            fn = f'{n:03d}_{k}.txt'
            (EX_DIR / fn).write_text(f'来源：{url}  抓取：{today}  （维基文库《{r["page"]}》，公版古籍原文摘录）\n{excerpt(t, *span)}\n', encoding='utf-8')
            ref = {'kind': r['kind'], 'work': r['work'], 'quote': quote, 'quote_s': r.get('quote_s') or nm.simp(quote),
                   'url': url, 'excerpt': f'_dev/zhuge_sources/{fn}'}
            hits = []
            for c in clauses(qian[n]):
                if len(c) >= 4:
                    m = locate(quote, c, nm)
                    if m and len(re.sub(r'[%s]' % re.escape(''.join(PUNCT)), '', quote[m[0]:m[1]])) == len(c) and m[1] - m[0] == len(c):
                        hits.append((c, quote[m[0]:m[1]]))
            if r['kind'] == 'A':
                if not hits:
                    print(f'FAIL {n} {r["work"]}: 声明 A 但签文没有整句在 quote 里')
                    bad += 1
                    continue
                ref['match'], ref['match_raw'] = hits[0]
            elif hits:
                print(f'WARN {n} {r["work"]}: 声明 B 但整句「{hits[0][0]}」对上了，应改 A')
            if r.get('note'):
                ref['note'] = r['note']
            refs.append(ref)
            print(f'ok   {n} {r["kind"]} {r["work"]}：{quote}')
        kinds = {x['kind'] for x in refs}
        grade = 'A' if 'A' in kinds else 'B' if 'B' in kinds else 'C'
        entries.append({'n': n, 'grade': grade, 'refs': refs, 'gist': e['gist']})
    entries.sort(key=lambda x: x['n'])
    doc = {'note': spec['note'], 'entries': entries}
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{"PASS" if not bad else "FAIL"} {bad} 条失败；写出 {out_path}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
