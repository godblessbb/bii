"""离线核对 zhuge/sources.json（签文出处）。不联网、不依赖 opencc 包。

用法：/opt/Alphie/.venv/bin/python _dev/zhuge_sources_check.py [仓库根，默认本文件上一级]

简繁归一表来自 OpenCC 自带字表（_dev/opencc/STCharacters.txt、TSCharacters.txt，BYVoid/OpenCC@fae2a0a，
与 _dev/zhuge_build_strokes.py 生成 strokes-data.js 用的是同一版本；Apache-2.0，见 _dev/opencc/LICENSE）：
两表每一行的键与全部候选视为同一组（如 于/於、发/發/髮），组内的字算同一个字。不手写任何对照表。

逐条核对：
  1. entries 恰为第 1–215 签，grade 与 refs 一致（有 A 即 A，否则有 B 即 B，否则 C；C 档 refs 为空）。
  2. 每条 ref 的 excerpt 文件存在、首行写有来源 URL 与抓取日期且 URL 与 ref.url 相同；quote 是摘录正文的逐字子串（空白不计）。
  3. quote_s 与 quote 按字表归一后逐字相同（简体显示版不许改字）。
  4. kind=A：match 是该签签文按 ，。；：、！？ 切开的某一整句（逐字照 qian.json），长度 ≥ 4；
     match_raw 是 quote 的子串；二者等长，且按字表归一后逐字相同。
任何一条不过就非零退出。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TABLES = ('STCharacters.txt', 'TSCharacters.txt')


class Norm:
    """OpenCC 字表并查集：同组字归一到同一个代表字。simp() 给出 TSCharacters 首选简体（逐字）。"""

    def __init__(self, d: Path = HERE / 'opencc'):
        self.parent: dict[str, str] = {}
        self.ts: dict[str, str] = {}
        for name in TABLES:
            for line in (d / name).read_text(encoding='utf-8').splitlines():
                if not line.strip() or line.startswith('#'):
                    continue
                k, v = line.split('\t')
                cands = v.split(' ')
                if name == 'TSCharacters.txt':
                    self.ts[k] = cands[0]
                for c in cands:
                    self._union(k, c)

    def _find(self, c: str) -> str:
        p = self.parent.get(c, c)
        if p != c:
            p = self._find(p)
            self.parent[c] = p
        return p

    def _union(self, a: str, b: str) -> None:
        ra, rb = self._find(a), self._find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)

    def key(self, c: str) -> str:
        return self._find(c)

    def same(self, a: str, b: str) -> bool:
        return len(a) == len(b) and all(self.key(x) == self.key(y) for x, y in zip(a, b))

    def simp(self, s: str) -> str:
        return ''.join(self.ts.get(c, c) for c in s)


def clauses(text: str) -> list[str]:
    return [c for c in re.split(r'[，。；：、！？\s]', text) if c]


def nows(s: str) -> str:
    return re.sub(r'\s', '', s)


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent
    nm = Norm()
    errs: list[str] = []

    def bad(msg: str) -> None:
        errs.append(msg)
        print('FAIL', msg)

    qian = {q['n']: q['text'] for q in json.loads((root / 'zhuge/qian.json').read_text(encoding='utf-8'))['qian']}
    doc = json.loads((root / 'zhuge/sources.json').read_text(encoding='utf-8'))
    E = doc.get('entries', [])
    if [e.get('n') for e in E] != list(range(1, 216)):
        bad('entries 不是第 1–215 签各一条')
    if not str(doc.get('note', '')).strip():
        bad('缺 note')
    cnt = {'A': 0, 'B': 0, 'C': 0}
    nref = 0
    for e in E:
        n, g, R = e.get('n'), e.get('grade'), e.get('refs', [])
        K = {r.get('kind') for r in R}
        want = 'A' if 'A' in K else 'B' if 'B' in K else 'C'
        if g != want:
            bad(f'{n}: grade={g}，按 refs 应为 {want}')
        cnt[g] = cnt.get(g, 0) + 1
        if not str(e.get('gist', '')).strip():
            bad(f'{n}: 缺 gist')
        for r in R:
            nref += 1
            tag = f'{n} {r.get("work")}'
            if r.get('kind') not in ('A', 'B'):
                bad(f'{tag}: kind={r.get("kind")}')
            for f in ('work', 'quote', 'quote_s', 'url', 'excerpt'):
                if not str(r.get(f, '')).strip():
                    bad(f'{tag}: 缺 {f}')
            if not str(r.get('url', '')).startswith('http'):
                bad(f'{tag}: url 不是 http(s)')
            ex = root / str(r.get('excerpt', ''))
            if not str(r.get('excerpt', '')).startswith('_dev/zhuge_sources/') or not ex.is_file():
                bad(f'{tag}: 摘录文件 {r.get("excerpt")} 不存在')
                continue
            head, _, body = ex.read_text(encoding='utf-8').partition('\n')
            if r.get('url') not in head or not re.search(r'\d{4}-\d{2}-\d{2}', head):
                bad(f'{tag}: 摘录首行没有写 ref.url 与抓取日期：{head[:80]}')
            q = r.get('quote', '')
            if not nows(q) or nows(q) not in nows(body):
                bad(f'{tag}: quote「{q}」不是摘录正文的子串')
            if not nm.same(nows(q), nows(r.get('quote_s', ''))):
                bad(f'{tag}: quote_s「{r.get("quote_s")}」与 quote「{q}」归一后不同')
            if r.get('kind') == 'A':
                m, mr = r.get('match', ''), r.get('match_raw', '')
                if m not in clauses(qian.get(n, '')) or len(m) < 4:
                    bad(f'{tag}: match「{m}」不是第 {n} 签签文的整句（≥4 字）')
                if not mr or mr not in nows(q):
                    bad(f'{tag}: match_raw「{mr}」不在 quote 里')
                if not nm.same(m, mr):
                    bad(f'{tag}: match「{m}」与 match_raw「{mr}」按 OpenCC 字表归一后不逐字相同')
    print(f'\n{"PASS" if not errs else "FAIL"} zhuge_sources_check: {len(errs)} failure(s); {nref} refs; 档位 {cnt}')
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main())
