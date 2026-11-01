"""生成 zhuge/strokes-data.js。

用法：python3 _dev/zhuge_build_strokes.py <moji.db> <STCharacters.txt> zhuge/strokes-data.js
  moji.db：npm 包 @mandel59/mojidata@1.9.3 的 dist/moji.db（内含 Unicode Unihan 18.0）
  STCharacters.txt：https://raw.githubusercontent.com/BYVoid/OpenCC/fae2a0a911c30764e669a7d8b0591cd8e852934a/data/dictionary/STCharacters.txt
"""
import sqlite3,sys,json,re
db,stc,out=sys.argv[1:4]
c=sqlite3.connect(db)
ks={u:v for u,v in c.execute('select UCS,value from unihan_kTotalStrokes')}
multi=[(u,v) for u,v in ks.items() if ' ' in v]
print('multi-valued',len(multi),multi[:5])
gb=[u for (u,) in c.execute('select UCS from unihan_kGB0')]
b5=[u for (u,) in c.execute('select UCS from unihan_kBigFive')]
print('gb',len(gb),'b5',len(b5))
s2t={}
for line in open(stc,encoding='utf-8'):
    if not line.strip() or line.startswith('#'): continue
    k,v=line.rstrip('\n').split('\t'); s2t[k]=v.split(' ')[0]
def st(u):
    v=ks.get(u)
    if not v: return None
    return int(v.split(' ')[-1])   # 多值时取最后一个（T 源，传统字形）
pairs={}; table={}
missing=[]
for u in gb:
    t=s2t.get(u,u)
    if t!=u: pairs[u]=t
    n=st(t)
    if n is None: missing.append(u); continue
    table[t]=n
for u in b5:
    n=st(u)
    if n is not None and u not in table:
        # 繁体输入：若它本身也是 OpenCC 的简体键（如 后/干），按映射走，不另记
        table[u]=n
print('missing',missing[:20],len(missing))
by={}
for ch,n in table.items(): by.setdefault(n,[]).append(ch)
for n in by: by[n]=''.join(sorted(by[n]))
S2T=''.join(k+v for k,v in sorted(pairs.items()))
js=('// 生成文件，勿手改：_dev/zhuge_build_strokes.py 生成。\n'
 '// 笔画：Unicode Unihan 18.0 kTotalStrokes（多值取最后一个，即传统字形 T 源）；Unicode License v3。\n'
 '// 简→繁：OpenCC data/dictionary/STCharacters.txt（BYVoid/OpenCC@fae2a0a），一简多繁取首个候选；Apache-2.0。\n'
 '// 收字：GB2312 全部 6763 字（经简→繁后）+ Big5 全部繁体字。\n'
 'export const S2T = ' + json.dumps(S2T,ensure_ascii=False) + ';\n'
 'export const STROKES = ' + json.dumps({str(k):by[k] for k in sorted(by)},ensure_ascii=False) + ';\n')
open(out,'w',encoding='utf-8').write(js)
print('pairs',len(pairs),'table',len(table),'bytes',len(js.encode()))
