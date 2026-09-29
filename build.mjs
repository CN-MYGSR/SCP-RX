// 把运行时文件组装成静态部署目录 dist/
// 项目本身是无构建步骤的原生 JS，这里只做「挑出运行时要用的文件」这一件事：
// 源码根目录里还有 _tools/（测试与截图）、README.md 等，不应进入部署产物。
//
// ⚠️ 不用 fs.cpSync(recursive:true)：在本机（Windows + 路径含全角冒号）上，
//    递归复制目录会让 Node 进程直接消失（退出码 127、零输出），
//    所以这里手写 mkdir + copyFile 的递归遍历。
import { rmSync, mkdirSync, existsSync, statSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'dist');
const ENTRIES = ['index.html', 'css', 'js', 'vendor', 'media'];

function copyTree(src, dst) {
  const st = statSync(src);
  if (st.isDirectory()) {
    mkdirSync(dst, { recursive: true });
    for (const name of readdirSync(src)) copyTree(join(src, name), join(dst, name));
  } else {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let files = 0;
for (const name of ENTRIES) {
  const src = join(root, name);
  if (!existsSync(src)) {
    console.error('[build] 缺少运行时条目: ' + name);
    process.exit(1);
  }
  copyTree(src, join(out, name));
  files++;
}

// 自检：部署目录顶层必须有 index.html
if (!existsSync(join(out, 'index.html'))) {
  console.error('[build] dist/ 顶层缺少 index.html');
  process.exit(1);
}
console.log('[build] dist/ 已生成，条目 ' + files + ' 个 -> ' + relative(root, out));
