/**
 * 真实 smoke 脚本的安全与判定门禁。
 *
 * smoke 本身需要公网和 headful Chrome，不能进普通 CI；但它「会不会删用户目录」
 * 和「全市场判定是不是结构化的」是纯静态事实，必须由确定性测试守住。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SMOKE_PATH = path.resolve(__dirname, '..', '..', '..', 'tests', 'smoke-exchange-prices.cjs');
const source = fs.readFileSync(SMOKE_PATH, 'utf8');

/** 执行或建议递归删除的特征；注释和错误文案里也不允许出现 */
const RECURSIVE_DELETE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // 短选项（-rf / -R / -fr）与长选项（--recursive）要分开写，字符类吃不掉第二个连字符
  { name: 'rm 短选项递归', pattern: /rm\s+-[a-zA-Z]*[rR]/ },
  { name: 'rm 长选项递归', pattern: /rm\s+--recursive\b/ },
  // fs.rm / fs.promises.rm / fs.rmSync / fs.rmdirSync 带 recursive 都是同一件事
  { name: 'rm 系列调用带 recursive', pattern: /\b(rm|rmSync|rmdirSync)\s*\([^)]*recursive/s },
  { name: 'rmdirSync', pattern: /\brmdirSync\b/ },
  { name: 'fs.promises.rm', pattern: /fs\.promises\.rm\b/ },
  { name: 'rimraf', pattern: /\brimraf\b/ },
  { name: '中文「递归删除」建议', pattern: /递归删除/ },
  { name: '中文「删除该目录」建议', pattern: /删除该目录|删掉该目录|清空 profile/ },
];

describe('smoke 脚本不得删除或建议删除任何目录', () => {
  it.each(RECURSIVE_DELETE_PATTERNS)('不含 $name', ({ pattern }) => {
    expect(pattern.test(source), pattern.source).toBe(false);
  });

  it('门禁能识别违规输入', () => {
    const violating = [
      `fs.rmSync(PROFILE, { recursive: true, force: true });`,
      `fs.rm(PROFILE, { recursive: true }, callback);`,
      `await fs.promises.rm(PROFILE, { recursive: true });`,
      `fs.rmdirSync(PROFILE, { recursive: true });`,
      `execSync('rimraf ' + PROFILE);`,
      `console.error('请先 rm -rf dist');`,
      `console.error('可以 rm -R dist 之后重来');`,
      `// 出错时执行 rm --recursive --force 清掉 profile`,
      `// 出错时可以递归删除 profile 重试`,
    ];
    for (const sample of violating) {
      const hit = RECURSIVE_DELETE_PATTERNS.some((rule) => rule.pattern.test(sample));
      expect(hit, sample).toBe(true);
    }
  });

  it('合法内容不得误报', () => {
    const legitimate = [
      `console.error('dist/ 不存在，请先执行 npm run build，再执行 npm run test:smoke');`,
      `await page.evaluate(() => new Promise((resolve) => window.chrome.storage.local.clear(resolve)));`,
      `fs.lstatSync(lock);`,
    ];
    for (const sample of legitimate) {
      const hit = RECURSIVE_DELETE_PATTERNS.some((rule) => rule.pattern.test(sample));
      expect(hit, sample).toBe(false);
    }
  });
});

describe('smoke 脚本的固定约定', () => {
  it('dist 缺失时只提示 build 与 test:smoke', () => {
    const line = source.split('\n').find((l) => l.includes('dist/ 不存在'))!;
    expect(line).toContain('npm run build');
    expect(line).toContain('npm run test:smoke');
  });

  it('文件头不声称可以直接挂进普通 CI', () => {
    const header = source.slice(0, source.indexOf('*/'));
    expect(header).not.toMatch(/直接挂到\s*CI|挂进\s*CI|加入普通\s*CI/);
    expect(header).toMatch(/不并入普通\s*CI|手动门禁/);
  });

  it('SingletonLock 用不跟随符号链接的检查，并且不删 profile', () => {
    expect(source).toContain('lstatSync');
    expect(source).not.toMatch(/existsSync\(\s*lock\s*\)/);
    expect(source).toMatch(/本脚本不会删除任何文件|不会删除任何文件/);
  });

  it('fresh storage 依旧走扩展内的 chrome.storage.local.clear()', () => {
    expect(source).toContain('chrome.storage.local.clear');
  });

  it('全市场判定是结构化的：用 URL / searchParams / POST body，而不是匹配 URL 字符串', () => {
    expect(source).toContain('new URL(record.url)');
    expect(source).toContain('searchParams');
    expect(source).toContain('HYPERLIQUID_FULL_MARKET_TYPES');
    // 旧的字符串正则表必须已经删掉
    expect(source).not.toContain('FULL_MARKET_URL_PATTERNS');
  });
});
