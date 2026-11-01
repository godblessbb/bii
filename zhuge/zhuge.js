// 诸葛武侯巧连神数：报三字 → 繁体完整笔画 → 上字×100 + 中字×10 + 下字×1 → 1–215 签号。页面与测试共用这一份实现。
// 规则原文与出处见 qian.json 的 rule / strokes 字段。
import { S2T, STROKES } from './strokes-data.js';

export const TOTAL = 215;

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
  return typeof ch === 'string' && /^[㐀-䶿一-鿿豈-﫿]$/u.test(ch);
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

// 序：「上字划作百，中字划作十，下字划作一」——笔画取完整数，不取个位
export function rawNumber(a, b, c) {
  return a * 100 + b * 10 + c;
}

// 减 215 的次数（页面演示用）
export function cuts(raw) {
  return raw > TOTAL ? Math.ceil(raw / TOTAL) - 1 : 0;
}

// 序：「若多则除去二百一十五数……早晚除至不过二百一十五数为度」——反复减 215 到不超过 215，整除得第 215 签
export function numberFromStrokes(a, b, c) {
  const raw = rawNumber(a, b, c);
  return raw - cuts(raw) * TOTAL;
}

// 三字直接得签号；有字查不到笔画时返回 null
export function qianNumber(c1, c2, c3) {
  const s = [c1, c2, c3].map(strokes);
  if (s.some((x) => x == null)) return null;
  return numberFromStrokes(s[0], s[1], s[2]);
}
