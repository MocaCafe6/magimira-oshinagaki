/**
 * 本番更新の一連の手順をまとめて実行する。
 *
 *   npm run refresh            X を再クロールして、判定・検証・ビルドまで通す
 *   npm run refresh -- --no-crawl   クロールを飛ばして再判定だけやり直す
 *
 * 会期が近づくと各サークルがお品書きを出し始めるので、
 * 大阪(8/14-16)・東京(8/28-30)の前は毎日これを回す。
 *
 * 検証で1つでも落ちたら中断する。担保が破れた状態のサイトは公開しない。
 */
import { spawn } from 'node:child_process';

type Step = { name: string; args: string[]; skip?: boolean };

function run(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn('npx', ['tsx', ...args], { stdio: 'inherit', shell: true });
    p.on('close', (code) => resolve(code ?? 1));
  });
}

function runNpm(script: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn('npm', ['run', script], { stdio: 'inherit', shell: true });
    p.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const noCrawl = process.argv.includes('--no-crawl');

  const steps: Step[] = [
    { name: '公式出店者一覧の取得', args: ['scripts/scrape-official.ts'] },
    { name: 'X のクロール', args: ['scripts/crawl-x.ts'], skip: noCrawl },
    { name: 'スコアと会場帰属の再計算', args: ['scripts/rescore.ts'] },
    { name: '画像読み取り結果の取り込み', args: ['scripts/apply-image-reads.ts'] },
    { name: '会場帰属の検証', args: ['scripts/verify-attribution.ts'] },
  ];

  for (const s of steps) {
    if (s.skip) {
      console.log(`\n── ${s.name}（スキップ）`);
      continue;
    }
    console.log(`\n── ${s.name}`);
    const code = await run(s.args);
    if (code !== 0) {
      // apply-image-reads は読み取り結果がまだ無ければ落ちる。それは想定内
      if (s.args[0]?.includes('apply-image-reads')) {
        console.log('   （画像読み取り結果はまだありません。続行します）');
        continue;
      }
      console.error(`\n✗ ${s.name} で失敗しました。ここで中断します。`);
      process.exit(1);
    }
  }

  console.log('\n── サイトのビルド');
  if ((await runNpm('build')) !== 0) {
    console.error('\n✗ ビルドに失敗しました。');
    process.exit(1);
  }

  console.log('\n── ビルド済みサイトの検査');
  if ((await run(['scripts/verify-site.ts'])) !== 0) {
    console.error('\n✗ 会場の合わない掲載があります。この状態で公開しないでください。');
    process.exit(1);
  }

  console.log('\n──────────────────────────────');
  console.log('✓ 更新が完了しました。out/ を公開できます。');
  console.log('  会場が未確定で非公開になっている投稿を拾うには:');
  console.log('    npm run prepare-image-review   判別対象の画像を集める');
  console.log('    （画像を読んで data/image-reads.json に追記）');
  console.log('    npm run apply-image-reads      公式データと照合して取り込む');
  console.log('  ANTHROPIC_API_KEY があれば npm run attribute-images で自動化できます。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
