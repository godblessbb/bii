// 诸葛神数：报三字 → 繁体笔画 → 百十个位 → 1–384 签号。页面与测试共用这一份实现。
// 规则原文与出处见 qian.json 的 rule / strokes 字段。
import { S2T, STROKES } from './strokes-data.js';

let s2t = null;
let table = null;

function load() {
  if (table) return;
  s2t = new Map();
  const pairs = Array.from(S2T);
  for (let i = 0; i + 1 < pairs.length; i += 2) s2t.set(pairs[i], pairs[i + 1]);
  table = new Map();
  for (const [n, chars] of Object.entries(STROKES)) {
    for (const ch of chars) table.set(ch, Number(n));
  }
}

// 是否一个汉字（含扩展 A 与兼容区）
export function isHan(ch) {
  return typeof ch === 'string' && /^[㐀-䶿一-鿿豈-﫿]$/u.test(ch);
}

// 简体 → 繁体（一简多繁取 OpenCC 首个候选；本身是繁体或简繁同形则原样）
export function toTrad(ch) {
  load();
  return s2t.get(ch) || ch;
}

// 繁体笔画数；不是单个汉字或查不到时返回 null
export function strokes(ch) {
  if (!isHan(ch)) return null;
  load();
  const n = table.get(toTrad(ch));
  return n == null ? null : n;
}

// 原文：九笔以内照算；十笔以外减十笔（二十笔同）；恰十 / 二十笔作零笔
export function digitOf(n) {
  return n % 10;
}

// 三位数（未换算前）
export function rawNumber(a, b, c) {
  return digitOf(a) * 100 + digitOf(b) * 10 + digitOf(c);
}

// 原文：过于三百八十四则减去三百八十四，减后仍多再减；000 按「余 0 取 384」
export function numberFromStrokes(a, b, c) {
  let n = rawNumber(a, b, c);
  while (n > 384) n -= 384;
  return n === 0 ? 384 : n;
}

// 三字直接得签号；有字查不到笔画时返回 null
export function qianNumber(c1, c2, c3) {
  const s = [c1, c2, c3].map(strokes);
  if (s.some((x) => x == null)) return null;
  return numberFromStrokes(s[0], s[1], s[2]);
}
