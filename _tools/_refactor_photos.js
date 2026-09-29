'use strict';
/* 把农场专属的 FARM.photos 抽成通用 PHOTOS 数组（两个任务共用） */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', 'js');

const files = ['06b_farm.js', '09_player.js', '13_hud.js', '15_main.js'];
let total = 0;
for (const f of files) {
  const p = path.join(ROOT, f);
  const src = fs.readFileSync(p, 'utf8');
  const before = (src.match(/FARM\.photos/g) || []).length;
  if (!before) { console.log('  跳过 ' + f + '（无匹配）'); continue; }
  const out = src.split('FARM.photos').join('PHOTOS');
  const after = (out.match(/FARM\.photos/g) || []).length;
  if (after !== 0) throw new Error(f + ' 仍有残留: ' + after);
  fs.writeFileSync(p, out);
  total += before;
  console.log('  ' + f + '：替换 ' + before + ' 处');
}
console.log('合计 ' + total + ' 处');
