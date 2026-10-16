'use strict';
/* 一次性替换：city_test.js 的 ② 段改成 IIFE 形式。
   ⚠️ 原写法 `({ 池子: ..., 其它: { ... }, 抽20次: (function(){...})() })` 会被
      Runtime.evaluate 当成语句块解析 → "is not a function"。改成最外层是 IIFE。
   用脚本而不是 Edit：Edit 对这种嵌套花括号的片段匹配不上。 */
const fs = require('fs');
const P = 'D:/SCP：RX/_tools/city_test.js';
let s = fs.readFileSync(P, 'utf8');

const startMark = "    const pool = await ev(`({";
const endMark = "    console.log('   ' + JSON.stringify(pool));";
const i0 = s.indexOf(startMark);
const i1 = s.indexOf(endMark);
if (i0 < 0) { console.error('❌ 找不到起点'); process.exit(1); }
if (i1 < 0 || i1 < i0) { console.error('❌ 找不到终点'); process.exit(1); }

const replacement = [
  "    const pool = await ev(`(function(){",
  "      const s = {};",
  "      for (let i = 0; i < 20; i++) { const k = rollRole(); s[k] = (s[k] || 0) + 1; }",
  "      return { 池子: rollPoolFor('city'), 其它行动池子大小: { breach: rollPoolFor('breach').length, fivek: rollPoolFor('fivek').length }, 抽20次: s };",
  "    })()`);",
].join('\n');

s = s.slice(0, i0) + replacement + s.slice(i1);
fs.writeFileSync(P, s);

const after = fs.readFileSync(P, 'utf8');
const n = after.split('(function(){').length - 1;
console.log('✅ 已替换（文件内 IIFE 数 ' + n + '）');
if (after.indexOf("await ev(`({") >= 0) { console.error('❌ 旧的 ({ 写法还在'); process.exit(1); }
console.log('✅ 旧的 ({ 写法已清除');
