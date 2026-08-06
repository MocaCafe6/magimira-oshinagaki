import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareByBooth,
  normalizeXHandle,
  parseBoothId,
  parseCreatorsMarket,
  parseSponsors,
  toAbsoluteUrl,
} from './official-parser';
import type { Creator } from './types';

// 公式サイトの実物から構造を写したフィクスチャ（2026/08/05 時点）
const MARKET_HTML = `
<ul class="booth_list br_t">
  <li>
    <h4 class="booth_name"><span>A-1</span>偽犬</h4>
    <div class="clm_b">
      <p class="booth_img"><img src="images/ex/market/cc/cc_niseinu.jpg" class="w100p"></p>
      <div class="booth_detail">
        <div class="booth_add">
          <span class="day_0814"><img src="images/ex/market/day_osaka_0814.svg"></span>
          <span class="day_0815"><img src="images/ex/market/day_osaka_0815.svg"></span>
          <span class="day_0816"><img src="images/ex/market/day_osaka_0816.svg"></span>
        </div>
        <ul class="booth_member std">
          <li>
            <p class="member_name">ぬゆり</p>
            <p class="member_link">
              <span><a href="https://karent.jp/artist/pp001059" target="_blank">KARENT<i class="ico_link"></i></a></span>
              <span><a href="https://x.com/nulut" target="_blank">X<i class="ico_link"></i></a></span>
            </p>
          </li>
        </ul>
      </div>
    </div>
  </li>
  <li>
    <h4 class="booth_name"><span>A-10</span>量産型西沢さん。</h4>
    <div class="booth_add">
      <span class="day_0815"></span>
      <span class="day_0816"></span>
    </div>
    <ul class="booth_member">
      <li>
        <p class="member_name">西沢さんP</p>
        <p class="member_link">
          <span><a href="https://twitter.com/nishizawasan/">X</a></span>
          <span><a href="https://www.youtube.com/@nishizawasan">YouTube</a></span>
        </p>
      </li>
    </ul>
  </li>
  <li class="kome">クリエイターズマーケットのエリアは撮影・録画・録音禁止です。</li>
</ul>
`;

const SPONSOR_HTML = `
<ul class="sponsor_booth_detail br_t_ll">
  <li id="spo_A1">
    <div class=" ">
      <h3 class="booth_name"><span>A1</span>CRECO　株式会社ヒューネット</h3>
      <div class="clm_b ">
        <p class="booth_img"><img src="images/ex/sponsor/booth_img_creco.jpg"></p>
        <div class="booth_text">
          <p>CRECOブースでは新作アイテムを販売します。</p>
          <p class="br_t_s"><a href="https://creco-shop.com/" target="_blank">CRECOショップはこちら<i class="ico_link"></i></a></p>
        </div>
      </div>
    </div>
  </li>
  <li id="spo_ガチャ">
    <div>
      <h3 class="booth_name"><span>ガチャ</span>（株）バンダイ</h3>
      <div class="booth_text"><p>ガシャポンを設置します。</p></div>
    </div>
  </li>
</ul>
`;

test('normalizeXHandle はドメイン差異を吸収する', () => {
  assert.equal(normalizeXHandle('https://x.com/nulut'), 'nulut');
  assert.equal(normalizeXHandle('https://twitter.com/nulut'), 'nulut');
  assert.equal(normalizeXHandle('https://mobile.twitter.com/nulut'), 'nulut');
  assert.equal(normalizeXHandle('https://www.x.com/nulut/'), 'nulut');
  assert.equal(normalizeXHandle('https://x.com/nulut?s=20'), 'nulut');
  // ステータスURLからもハンドルだけ取り出す
  assert.equal(normalizeXHandle('https://x.com/mothy_akuno/status/1234567890'), 'mothy_akuno');
  // 大小文字は保持する（表示に使うため）
  assert.equal(normalizeXHandle('https://x.com/HeavenzP'), 'HeavenzP');
});

test('normalizeXHandle は X 以外・予約パスを弾く', () => {
  assert.equal(normalizeXHandle('https://karent.jp/artist/pp001059'), null);
  assert.equal(normalizeXHandle('https://www.youtube.com/@nishizawasan'), null);
  assert.equal(normalizeXHandle('https://x.com/i/flow/login'), null);
  assert.equal(normalizeXHandle('https://x.com/search?q=test'), null);
  assert.equal(normalizeXHandle('https://x.com/'), null);
  assert.equal(normalizeXHandle('not a url'), null);
  // 15文字を超えるハンドルは存在しない
  assert.equal(normalizeXHandle('https://x.com/abcdefghijklmnopqrstu'), null);
});

test('parseBoothId は両形式と非定型IDを扱う', () => {
  assert.deepEqual(parseBoothId('A-1'), { line: 'A', boothNo: 1 });
  assert.deepEqual(parseBoothId('G-11'), { line: 'G', boothNo: 11 });
  assert.deepEqual(parseBoothId('A1'), { line: 'A', boothNo: 1 });
  assert.deepEqual(parseBoothId('D10'), { line: 'D', boothNo: 10 });
  // 出展ブースの非定型ID
  assert.deepEqual(parseBoothId('ガチャ'), { line: null, boothNo: null });
  assert.deepEqual(parseBoothId(''), { line: null, boothNo: null });
});

test('toAbsoluteUrl は公式サイトの相対パスを解決する', () => {
  assert.equal(
    toAbsoluteUrl('images/ex/market/cc/cc_niseinu.jpg'),
    'https://magicalmirai.com/2026/images/ex/market/cc/cc_niseinu.jpg',
  );
  assert.equal(toAbsoluteUrl('https://x.com/nulut'), 'https://x.com/nulut');
  assert.equal(toAbsoluteUrl(undefined), null);
});

test('parseCreatorsMarket は実構造からブース情報を取り出す', () => {
  const list = parseCreatorsMarket(MARKET_HTML, 'osaka');
  // 注意書きの li.kome は除外される
  assert.equal(list.length, 2);

  const a1 = list[0]!;
  assert.equal(a1.id, 'osaka-A-1');
  assert.equal(a1.boothId, 'A-1');
  assert.equal(a1.line, 'A');
  assert.equal(a1.boothNo, 1);
  assert.equal(a1.circleName, '偽犬');
  assert.equal(a1.kind, 'creators-market');
  assert.equal(a1.logoUrl, 'https://magicalmirai.com/2026/images/ex/market/cc/cc_niseinu.jpg');
  assert.deepEqual(a1.days, ['2026-08-14', '2026-08-15', '2026-08-16']);
  assert.equal(a1.members.length, 1);
  assert.equal(a1.members[0]!.name, 'ぬゆり');
  assert.deepEqual(a1.xHandles, ['nulut']);
  // KARENT リンクは kind:karent として保持され、X ハンドルには混ざらない
  assert.deepEqual(
    a1.members[0]!.links.map((l) => l.kind),
    ['karent', 'x'],
  );
});

test('parseCreatorsMarket は参加日の絞り込みを反映する', () => {
  const list = parseCreatorsMarket(MARKET_HTML, 'osaka');
  const a10 = list[1]!;
  assert.equal(a10.circleName, '量産型西沢さん。');
  // 8/14 のアイコンが無いので 8/15・8/16 のみ
  assert.deepEqual(a10.days, ['2026-08-15', '2026-08-16']);
  // twitter.com も x ハンドルとして正規化される
  assert.deepEqual(a10.xHandles, ['nishizawasan']);
});

test('parseCreatorsMarket は日別アイコンが無ければ全日扱いにする', () => {
  const html = `<ul class="booth_list"><li>
    <h4 class="booth_name"><span>B-1</span>テスト</h4>
  </li></ul>`;
  const list = parseCreatorsMarket(html, 'tokyo');
  // 表示から漏らさない側に倒す
  assert.deepEqual(list[0]!.days, ['2026-08-28', '2026-08-29', '2026-08-30']);
});

test('parseSponsors は出展ブースを取り出し非定型IDでも一意なidを作る', () => {
  const list = parseSponsors(SPONSOR_HTML, 'osaka');
  assert.equal(list.length, 2);

  const a1 = list.find((c) => c.boothId === 'A1')!;
  assert.equal(a1.kind, 'sponsor');
  assert.equal(a1.circleName, 'CRECO 株式会社ヒューネット'); // 全角スペースは畳まれる
  assert.equal(a1.line, 'A');
  assert.equal(a1.boothNo, 1);
  assert.equal(a1.note, 'CRECOブースでは新作アイテムを販売します。');
  // 説明文にリンクのラベルが混ざらない
  assert.ok(!a1.note!.includes('CRECOショップ'));
  assert.deepEqual(a1.members[0]!.links.map((l) => l.url), ['https://creco-shop.com/']);
  // 出展ブースは全日参加
  assert.deepEqual(a1.days, ['2026-08-14', '2026-08-15', '2026-08-16']);

  const gacha = list.find((c) => c.circleName === '（株）バンダイ')!;
  assert.equal(gacha.id, 'osaka-sponsor-ガチャ');
  assert.equal(gacha.line, null);
  assert.equal(gacha.boothNo, null);
});

test('DOM構造が変わればパース結果は0件になり、呼び出し側のアサーションが働く', () => {
  // セレクタが一致しないHTML（公式サイトのクラス名変更を模擬）
  const renamed = MARKET_HTML.replace(/booth_list/g, 'booth_list_v2');
  assert.equal(parseCreatorsMarket(renamed, 'osaka').length, 0);

  const renamedSponsor = SPONSOR_HTML.replace(/sponsor_booth_detail/g, 'sponsor_detail_v2');
  assert.equal(parseSponsors(renamedSponsor, 'osaka').length, 0);

  // member_link のクラス名が変わると X リンクが 0 本になる
  const linkRenamed = MARKET_HTML.replace(/member_link/g, 'member_links');
  const list = parseCreatorsMarket(linkRenamed, 'osaka');
  assert.equal(list.length, 2, 'ブース自体は取れる');
  assert.equal(
    list.reduce((n, c) => n + c.xHandles.length, 0),
    0,
    'X リンクだけが 0 になる（この差を件数アサーションで検知する）',
  );
});

test('ブースを共有する複数サークルに一意なIDを振る', () => {
  // 実データにある状況: 1つのブースを日替わりで2サークルが共有する。
  // ここで衝突すると詳細ページが生成されず、片方に到達できなくなる。
  const html = `<ul class="booth_list">
    <li>
      <h4 class="booth_name"><span>B-9</span>azm studio</h4>
      <div class="booth_add"><span class="day_0814"></span><span class="day_0815"></span></div>
    </li>
    <li>
      <h4 class="booth_name"><span>B-9</span>森羅盤商会</h4>
      <div class="booth_add"><span class="day_0816"></span></div>
    </li>
    <li>
      <h4 class="booth_name"><span>B-10</span>単独サークル</h4>
      <div class="booth_add"><span class="day_0814"></span></div>
    </li>
  </ul>`;
  const list = parseCreatorsMarket(html, 'osaka');
  const ids = list.map((c) => c.id);
  assert.equal(new Set(ids).size, 3, `IDが重複している: ${ids.join(', ')}`);

  // 共有されていないブースは素の ID のままにする（URLを綺麗に保つ）
  const solo = list.find((c) => c.circleName === '単独サークル')!;
  assert.equal(solo.id, 'osaka-B-10');

  // 共有ブースは両方に判別子が付く（どちらかが素、という非対称にしない）
  const shared = list.filter((c) => c.boothId === 'B-9');
  for (const c of shared) {
    assert.match(c.id, /^osaka-B-9-[0-9a-f]{6}$/, `想定外のID: ${c.id}`);
  }
});

test('共有ブースのIDは公式サイトの並び順に依存しない', () => {
  // 公式サイトで順序が入れ替わってもお気に入りが外れないこと
  const mk = (order: string[]) => `<ul class="booth_list">${order
    .map((n) => `<li><h4 class="booth_name"><span>B-9</span>${n}</h4></li>`)
    .join('')}</ul>`;

  const a = parseCreatorsMarket(mk(['azm studio', '森羅盤商会']), 'osaka');
  const b = parseCreatorsMarket(mk(['森羅盤商会', 'azm studio']), 'osaka');

  const idOf = (list: Creator[], name: string) => list.find((c) => c.circleName === name)!.id;
  assert.equal(idOf(a, 'azm studio'), idOf(b, 'azm studio'));
  assert.equal(idOf(a, '森羅盤商会'), idOf(b, '森羅盤商会'));
});

test('出展ブースは非定型IDでも一意になる', () => {
  const html = `<ul class="sponsor_booth_detail">
    <li><div><h3 class="booth_name"><span></span>大阪府赤十字血液センター</h3></div></li>
    <li><div><h3 class="booth_name"><span></span>別の団体</h3></div></li>
    <li><div><h3 class="booth_name"><span>ガチャ</span>（株）バンダイ</h3></div></li>
  </ul>`;
  const list = parseSponsors(html, 'osaka');
  const ids = list.map((c) => c.id);
  assert.equal(new Set(ids).size, 3, `IDが重複している: ${ids.join(', ')}`);
});

test('compareByBooth は列→番号順で並べ、非定型IDを末尾に置く', () => {
  const mk = (boothId: string, circleName = 'x'): Creator => {
    const { line, boothNo } = parseBoothId(boothId);
    return {
      id: boothId, venue: 'osaka', kind: 'creators-market', boothId,
      line, boothNo, circleName, logoUrl: null, days: [], members: [],
      xHandles: [], note: null,
    };
  };
  const sorted = [mk('B-2'), mk('ガチャ'), mk('A-10'), mk('A-2'), mk('B-1')]
    .sort(compareByBooth)
    .map((c) => c.boothId);
  // A-10 が A-2 より後ろに来る（文字列比較ではなく数値比較になっている）
  assert.deepEqual(sorted, ['A-2', 'A-10', 'B-1', 'B-2', 'ガチャ']);
});
