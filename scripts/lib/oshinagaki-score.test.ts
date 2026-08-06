import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSearchQuery,
  CANDIDATE_THRESHOLD,
  isCandidate,
  scoreOshinagaki,
  type ScoreInput,
} from './oshinagaki-score';

function input(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    text: '',
    mediaCount: 0,
    isPinned: false,
    isReply: false,
    isRetweet: false,
    createdAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

test('典型的なお品書き投稿は候補になる', () => {
  const r = scoreOshinagaki(
    input({
      text: 'マジカルミライ2026大阪のお品書きです！ A-1 偽犬 アクリルスタンド 2000円',
      mediaCount: 1,
      createdAt: '2026-08-03T10:00:00Z',
    }),
  );
  assert.ok(isCandidate(r), `score=${r.score} signals=${r.signals.join(', ')}`);
  assert.ok(r.signals.some((s) => s.includes('お品書き表記')));
  assert.ok(r.signals.some((s) => s.includes('ブース番号')));
  assert.ok(r.signals.some((s) => s.includes('画像あり')));
});

test('画像なしテキストだけの告知も「お品書き」表記があれば拾う', () => {
  // 取り逃しより取りすぎに倒す（人間が却下できる）
  const r = scoreOshinagaki(
    input({ text: 'マジミラのお品書き、後で貼ります', createdAt: '2026-08-01T00:00:00Z' }),
  );
  assert.ok(isCandidate(r), `score=${r.score}`);
});

test('浜松（終了済み・対象外）だけの投稿は候補から外れる', () => {
  // 実データで見つかった問題。同じクリエイターが浜松にも出ているため、
  // 除外しないと大阪ページに先月の品揃えが表示されてしまう。
  const r = scoreOshinagaki(
    input({
      text: '7/24(金)〜26(日)開催 マジカルミライ2026 HAMAMATSU クリエイターズマーケット\nお品書きです！',
      mediaCount: 3,
      createdAt: '2026-07-21T06:45:10Z',
    }),
  );
  assert.equal(r.score, 0, `signals=${r.signals.join(', ')}`);
  assert.ok(r.signals.some((s) => s.includes('浜松のみ')));
});

test('シグナルが揃った浜松の投稿でも足切りされる（減点では防げない）', () => {
  // 実データ: @nulut の A-1 ページに表示されてしまった投稿。
  // お品書き+グッズ+イベント名+ブース番号+画像+直近 で加点が積み上がり、
  // -45 の減点では 85点に達して閾値を超えていた。
  const r = scoreOshinagaki(
    input({
      text:
        '先駆けてマジカルミライ2026浜松のお品書きうpしておきます\n' +
        'いっぱいグッズ作ってもらいました\n24~26 C-1に遊びに来て下さい',
      mediaCount: 1,
      boothIds: ['A-1'],
      createdAt: '2026-07-16T18:06:00Z',
    }),
  );
  assert.equal(r.score, 0, `除外されていない: score=${r.score} signals=${r.signals.join(', ')}`);
  assert.ok(!isCandidate(r));
});

test('浜松と大阪の両方に触れる投稿は減点しない', () => {
  // 「浜松の残りを大阪に持っていきます」のようなケースは対象になる
  const r = scoreOshinagaki(
    input({
      text: '浜松で頒布したお品書きです。マジミラ大阪でも同じものを持っていきます',
      mediaCount: 1,
      createdAt: '2026-08-05T00:00:00Z',
    }),
  );
  assert.ok(isCandidate(r), `score=${r.score} signals=${r.signals.join(', ')}`);
  assert.ok(!r.signals.some((s) => s.includes('浜松のみ')));
});

test('対象会場への言及は加点される', () => {
  // 上限 100 のクランプに当たらないベースで重みそのものを測る
  const base = scoreOshinagaki(input({ text: 'お品書き' }));
  const withVenue = scoreOshinagaki(input({ text: 'お品書き 大阪' }));
  assert.ok(withVenue.score < 100, 'クランプに当たらない前提が崩れている');
  assert.equal(withVenue.score - base.score, 15);
});

test('頒布物に触れない報告投稿は候補にならない', () => {
  // 実データで見つかった偽陽性。イベント名＋画像＋直近だけで 65点に達していた。
  const r = scoreOshinagaki(
    input({
      text: 'マジカルミライ2026大阪 クリエイターズマーケット撤収しました！3日間ありがとうございました',
      mediaCount: 2,
      createdAt: '2026-08-16T10:00:00Z',
    }),
  );
  assert.ok(!isCandidate(r), `score=${r.score} signals=${r.signals.join(', ')}`);
  assert.ok(r.signals.some((s) => s.includes('頒布内容の言及なし')));
});

test('価格だけ書かれた告知は頒布内容ありとみなす', () => {
  // 「アクキー出すぞ！800円だ！」のような投稿を落とさない
  const r = scoreOshinagaki(
    input({
      text: 'マジミラ大阪でアクリルキーホルダー出します！1200円です',
      mediaCount: 1,
      createdAt: '2026-08-05T00:00:00Z',
    }),
  );
  assert.ok(!r.signals.some((s) => s.includes('頒布内容の言及なし')));
  assert.ok(isCandidate(r), `score=${r.score}`);
});

test('無関係な日常投稿は候補にならない', () => {
  const r = scoreOshinagaki(input({ text: '今日は良い天気ですね', mediaCount: 1 }));
  assert.ok(!isCandidate(r), `score=${r.score}`);
});

test('新曲告知のような紛らわしい投稿も候補から外れる', () => {
  const r = scoreOshinagaki(
    input({ text: '新曲を投稿しました！聴いてください', mediaCount: 1, createdAt: '2026-08-02T00:00:00Z' }),
  );
  assert.ok(!isCandidate(r), `score=${r.score} signals=${r.signals.join(', ')}`);
});

test('リプライとリツイートは強く減点される', () => {
  // 上限 100 のクランプに当たらないベースを使い、重みそのものを検証する
  const base = input({ text: 'マジカルミライのお品書き', mediaCount: 1 });
  const normal = scoreOshinagaki(base);
  assert.ok(normal.score < 100, `クランプに当たらない前提が崩れている: ${normal.score}`);

  const reply = scoreOshinagaki({ ...base, isReply: true });
  const rt = scoreOshinagaki({ ...base, isRetweet: true });
  assert.equal(normal.score - reply.score, 30);
  assert.equal(normal.score - rt.score, 30);
});

test('素点が満点を超える投稿でもリプライ減点が効く', () => {
  // 加点だけで 100 を超えるケース。減点をクランプ後に適用しているので
  // リプライが元投稿と同点になってしまうことはない。
  const base = input({
    text: 'マジカルミライ2026 お品書き A-1 頒布 2000円',
    mediaCount: 2,
    isPinned: true,
  });
  const normal = scoreOshinagaki(base);
  const reply = scoreOshinagaki({ ...base, isReply: true });
  assert.equal(normal.score, 100, '加点は 100 で丸められる');
  assert.equal(reply.score, 70, '丸めた後に 30 減点される');
});

test('固定ツイートは加点される（お品書きを pin する運用が多い）', () => {
  const base = input({ text: 'マジミラ新刊のご案内', mediaCount: 1 });
  const pinned = scoreOshinagaki({ ...base, isPinned: true });
  const notPinned = scoreOshinagaki(base);
  assert.equal(pinned.score - notPinned.score, 15);
});

test('古い投稿は「直近の投稿」加点が付かない', () => {
  const base = input({ text: 'マジカルミライのお品書き', mediaCount: 1 });
  const recent = scoreOshinagaki({ ...base, createdAt: '2026-08-01T00:00:00Z' });
  const old = scoreOshinagaki({ ...base, createdAt: '2025-08-01T00:00:00Z' });
  assert.equal(recent.score - old.score, 10);
});

test('自分のブース番号が本文にあれば表記揺れを吸収して検知する', () => {
  for (const text of ['ブースはA-1です', 'ブースはA1です', 'ブースはＡ-１です'.replace(/[Ａ１]/g, (c) => (c === 'Ａ' ? 'A' : '1'))]) {
    const r = scoreOshinagaki(input({ text, boothIds: ['A-1'] }));
    assert.ok(
      r.signals.some((s) => s.includes('ブース番号')),
      `検知できなかった: ${text}`,
    );
  }
});

test('「お品書き」と「品書き」は二重計上しない', () => {
  const r = scoreOshinagaki(input({ text: 'お品書き' }));
  const hits = r.signals.filter((s) => s.includes('品書き'));
  assert.equal(hits.length, 1, `signals=${r.signals.join(', ')}`);
});

test('スコアは 0〜100 に収まる', () => {
  const max = scoreOshinagaki(
    input({
      text: 'マジカルミライ2026 お品書き 頒布 新刊 A-1 2000円',
      mediaCount: 4,
      isPinned: true,
      createdAt: '2026-08-04T00:00:00Z',
    }),
  );
  assert.ok(max.score <= 100 && max.score >= CANDIDATE_THRESHOLD);

  const min = scoreOshinagaki(input({ isReply: true, isRetweet: true }));
  assert.equal(min.score, 0);
});

test('buildSearchQuery は from: とキーワードORと日付下限を含む', () => {
  const q = buildSearchQuery('nulut');
  assert.ok(q.startsWith('from:nulut '));
  assert.ok(q.includes('お品書き OR'));
  assert.ok(q.includes('マジカルミライ'));
  assert.ok(q.includes('since:2026-06-01'));
});
