/**
 * ビルド済みサイト（out/）を実際に読んで、各会場ページに他会場のお品書きが
 * 混ざっていないかを検査する。
 *
 * verify-attribution.ts が data/*.json の段階で検証するのに対し、
 * こちらは「最終的に閲覧者が見るHTML」を材料にする。
 * 実際、attribution が正しくても表示側の経路で別会場の投稿が
 * 出ていたことがあった（多会場投稿で画像だけ浜松のもの）ので、
 * データとHTMLの両方を見る。
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { REF_VENUE_META, REF_VENUES, VENUES, type RefVenue, type Venue } from './lib/types';
import { imageBoundVenues, normalizeText } from './lib/venue-attribution';

const OUT = path.join(process.cwd(), 'out');

type Violation = { page: string; reason: string; excerpt: string };

/** 投稿本文は <p class="... whitespace-pre-wrap"> に入る */
const POST_TEXT_RE = /<p class="[^"]*whitespace-pre-wrap[^"]*">([\s\S]*?)<\/p>/g;

/**
 * 「参考：浜松で頒布されたお品書き」の枠。
 * ここに入るものは意図的に浜松のお品書きなので、混入として数えない。
 * ただし**枠が正しく明示されていること自体**は検査する
 * （明示が無いまま浜松のお品書きが並んでいたら担保が崩れる）。
 */
const REFERENCE_MARKER = '浜松会場（7/24〜26・終了）';

function decode(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function main() {
  let pages: string[];
  try {
    pages = await readdir(path.join(OUT, 'creator'));
  } catch {
    console.error('out/creator が見つかりません。先に npm run build を実行してください。');
    process.exit(1);
  }

  const violations: Violation[] = [];
  let checked = 0;
  let postsSeen = 0;
  let referencePages = 0;

  for (const dir of pages) {
    const venue = VENUES.find((v) => dir.startsWith(`${v}-`)) as Venue | undefined;
    if (!venue) continue;
    const file = path.join(OUT, 'creator', dir, 'index.html');
    let html: string;
    try {
      html = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    checked++;

    // 「参考：浜松で頒布されたお品書き」の枠がある場合、そこから後ろは
    // 意図的に浜松のお品書きなので混入として数えない。
    // 枠の明示が無いまま浜松のお品書きが並んでいたら、それは混入。
    const refAt = html.indexOf(REFERENCE_MARKER);
    const mainHtml = refAt >= 0 ? html.slice(0, refAt) : html;
    if (refAt >= 0) referencePages++;

    for (const m of mainHtml.matchAll(POST_TEXT_RE)) {
      const text = decode(m[1] ?? '');
      if (!text.trim()) continue;
      postsSeen++;
      const norm = normalizeText(text);
      const excerpt = text.replace(/\s+/g, ' ').slice(0, 110);

      // 1. 本文が画像を別会場のお品書きだと言っている
      const bound = imageBoundVenues(text);
      if (bound.length > 0 && !bound.includes(venue)) {
        violations.push({
          page: dir,
          reason: `画像が「${bound.map((b) => REF_VENUE_META[b].label).join('・')}のお品書き」と書かれている`,
          excerpt,
        });
        continue;
      }

      // 2. 浜松のことしか書いていない投稿が、大阪・東京のページに出ている。
      //    これが最初に担保を破った混入。大阪と東京の間の言及は見ない。
      //    クリエイターは両会場に出るので片方だけに触れることは普通にあり、
      //    「2024年の東京・千本桜展以来ですかね」のような余談も混ざる。
      //    会場の証明は帰属判定が受け持っている。
      const mentioned = REF_VENUES.filter((v: RefVenue) =>
        REF_VENUE_META[v].aliases.some((a) => norm.includes(normalizeText(a))),
      );
      if (mentioned.length > 0 && mentioned.every((v) => v === 'hamamatsu')) {
        violations.push({
          page: dir,
          reason: '浜松のことしか書いていない',
          excerpt,
        });
        continue;
      }

      // 3. 終了したイベントの振り返り
      if (/ありがとうございまし|撤収しました|完売しました|終了しました/.test(text)) {
        violations.push({ page: dir, reason: '終了報告・お礼の投稿', excerpt });
      }
    }
  }

  console.log('\nビルド済みサイトの検査');
  console.log(`  サークルページ: ${checked}件 / 掲載中の投稿: ${postsSeen}件`);
  console.log(`  参考枠（浜松のお品書き）を出しているページ: ${referencePages}件`);

  if (violations.length > 0) {
    console.error(`\n✗ 会場の合わない掲載が ${violations.length}件 あります\n`);
    for (const v of violations) {
      console.error(`  ${v.page}  — ${v.reason}`);
      console.error(`    ${v.excerpt}`);
    }
    process.exit(1);
  }

  console.log('\n✓ 各会場ページの掲載内容が、その会場のものだけであることを確認しました。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
