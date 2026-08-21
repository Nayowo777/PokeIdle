import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const upstreamUrl = 'https://github.com/ZTMYO/PokeIdle';
const androidBranchUrl = 'https://github.com/Nayowo777/PokeIdle/tree/feature/save-transfer';

test('设置页同时展示原项目和 Android 分支地址', async () => {
  const source = await readFile(new URL('../src/views.js', import.meta.url), 'utf8');

  assert.match(source, new RegExp(`href="${upstreamUrl}"[^>]*id="githubLink"`));
  assert.match(source, new RegExp(`href="${androidBranchUrl}"[^>]*id="androidBranchLink"`));
  assert.match(source, /id="androidBranchLink"[^>]*class="settings-footer-link"[^>]*target="_blank"[^>]*rel="noopener"/);
});

test('README 说明分支关系和 Android 构建入口', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, new RegExp(upstreamUrl.replaceAll('/', '\\/')));
  assert.match(readme, new RegExp(androidBranchUrl.replaceAll('/', '\\/')));
  assert.match(readme, /Android 增强分支/);
  assert.match(readme, /npm run android:build/);
  assert.match(readme, /dist\/android/);
});
