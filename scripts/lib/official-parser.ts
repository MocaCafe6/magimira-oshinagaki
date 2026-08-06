/**
 * マジカルミライ公式サイトの出店者一覧パーサ。
 *
 * 対象ページはサーバレンダリングされた静的 HTML なので Playwright は不要。
 * DOM 構造は 2026/08/05 時点の実物で確認済み（下記コメント参照）。
 */

import { createHash } from 'node:crypto';

import * as cheerio from 'cheerio';
import type { Creator, LinkKind, Member, MemberLink, RefVenue, Venue } from './types';
import { REF_VENUE_META, VENUE_META } from './types';

/**
 * 判定用に持つ、会場ごとの出展情報（浜松を含む）。
 * サイトには表示しないが、「この投稿はどの会場のものか」を
 * 公式データと照合して確定するために使う。
 */
export type OfficialListing = {
  venue: RefVenue;
  boothId: string | null;
  circleName: string;
  days: string[];
  xHandles: string[];
};

/**
 * 出展ブース（企業）も判定用の一覧に加える。
 *
 * これが無いと企業ブースの投稿は会場を確定できず、永久に非公開になる。
 * ブース番号の名前空間はクリエイターズマーケットと別（"A1" と "A-1"）だが、
 * 照合はハンドル単位で行うので混ざらない。
 */
export function parseSponsorListings(html: string, venue: RefVenue): OfficialListing[] {
  const $ = cheerio.load(html);
  const allDays = REF_VENUE_META[venue].days;
  const out: OfficialListing[] = [];

  $('ul.sponsor_booth_detail > li').each((_, li) => {
    const $li = $(li);
    const $name = $li.find('h3.booth_name').first();
    if ($name.length === 0) return;

    const boothId = tidy($name.find('span').first().text());
    const $clone = $name.clone();
    $clone.find('span').remove();
    const circleName = tidy($clone.text());
    if (!circleName) return;

    const xHandles: string[] = [];
    $li.find('div.booth_text a[href]').each((__, a) => {
      const href = $(a).attr('href');
      if (!href) return;
      const h = normalizeXHandle(href);
      if (h && !xHandles.includes(h)) xHandles.push(h);
    });

    out.push({
      venue,
      boothId: boothId || null,
      circleName,
      // 出展ブースは全日開催
      days: [...allDays],
      xHandles,
    });
  });

  return out;
}

/**
 * 会場帰属の判定だけに使う軽量な一覧を作る。
 * 浜松にも使えるよう、表示用の Creator とは別に持つ。
 */
export function parseListings(html: string, venue: RefVenue): OfficialListing[] {
  const $ = cheerio.load(html);
  const allDays = REF_VENUE_META[venue].days;
  const out: OfficialListing[] = [];

  $('ul.booth_list > li').each((_, li) => {
    const $li = $(li);
    const $name = $li.find('h4.booth_name').first();
    if ($name.length === 0) return;

    const boothId = tidy($name.find('span').first().text());
    const $clone = $name.clone();
    $clone.find('span').remove();
    const circleName = tidy($clone.text());
    if (!boothId && !circleName) return;

    const days: string[] = [];
    $li.find('.booth_add span[class]').each((__, sp) => {
      for (const cls of ($(sp).attr('class') ?? '').split(/\s+/)) {
        const iso = dayClassToIso(cls);
        if (iso && !days.includes(iso)) days.push(iso);
      }
    });
    days.sort();

    const xHandles: string[] = [];
    $li.find('p.member_link a[href]').each((__, a) => {
      const href = $(a).attr('href');
      if (!href) return;
      const h = normalizeXHandle(href);
      if (h && !xHandles.includes(h)) xHandles.push(h);
    });

    out.push({
      venue,
      boothId: boothId || null,
      circleName,
      days: days.length > 0 ? days : [...allDays],
      xHandles,
    });
  });

  return out;
}

const SITE_BASE = 'https://magicalmirai.com/2026/';

/** 公式サイトの相対パスを絶対URLにする */
export function toAbsoluteUrl(src: string | undefined): string | null {
  if (!src) return null;
  try {
    return new URL(src, SITE_BASE).toString();
  } catch {
    return null;
  }
}

/**
 * X のプロフィールURLからハンドルを取り出す。
 * x.com / twitter.com / mobile.twitter.com を統一し、/status/ を含むURLからも拾う。
 * X のハンドルは大小文字を保持する（表示に使うため小文字化しない）。
 */
export function normalizeXHandle(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'x.com' && host !== 'twitter.com' && host !== 'mobile.twitter.com') {
    return null;
  }
  const first = u.pathname.split('/').filter(Boolean)[0];
  if (!first) return null;
  // プロフィール以外のパスを除外
  const reserved = new Set([
    'i', 'home', 'search', 'intent', 'share', 'hashtag',
    'explore', 'notifications', 'messages', 'settings', 'compose',
  ]);
  if (reserved.has(first.toLowerCase())) return null;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(first)) return null;
  return first;
}

function classifyLink(url: string): LinkKind {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return 'web';
  }
  if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') return 'x';
  if (host.endsWith('karent.jp')) return 'karent';
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube';
  return 'web';
}

/** 全角スペース・改行・連続空白を畳んでトリムする */
function tidy(s: string): string {
  return s.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * ブースIDから列と番号を取り出す。
 * クリエイターズマーケットは "A-1"、出展ブースは "A1" 形式。
 * "ガチャ" のような非定型IDや空文字は null を返す。
 */
export function parseBoothId(boothId: string): { line: string | null; boothNo: number | null } {
  const m = /^([A-Z])-?(\d+)$/.exec(boothId.trim().toUpperCase());
  if (!m) return { line: null, boothNo: null };
  return { line: m[1]!, boothNo: Number(m[2]) };
}

/** class="day_0814" から 2026-08-14 を作る */
function dayClassToIso(cls: string): string | null {
  const m = /^day_(\d{2})(\d{2})$/.exec(cls);
  if (!m) return null;
  return `2026-${m[1]}-${m[2]}`;
}

function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 6);
}

/**
 * サークルの一意なIDを決める。
 *
 * 1つのブースを複数サークルが日替わりで共有することがある
 * （大阪4組・東京6組）。`${venue}-${boothId}` だけでは衝突し、
 * 2番目以降のサークルの詳細ページが生成されず到達不能になる。
 *
 * 共有されているブースだけサークル名のハッシュを足す。
 * 出現順ではなく名前から決まるので、公式サイトの並びが変わっても
 * ID は変わらない（お気に入りが外れない）。
 */
function assignIds(
  venue: Venue,
  entries: { boothId: string | null; circleName: string }[],
  prefix = '',
): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const k = e.boothId ?? '';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return entries.map((e) => {
    const base = `${venue}${prefix}`;
    if (!e.boothId) {
      // ブース番号が無い項目（出展ブースの一部）は名前で一意にする
      return `${base}-${shortHash(e.circleName)}`;
    }
    const shared = (counts.get(e.boothId) ?? 0) > 1;
    return shared
      ? `${base}-${e.boothId}-${shortHash(e.circleName)}`
      : `${base}-${e.boothId}`;
  });
}

// ---------------------------------------------------------------------------
// クリエイターズマーケット
// ---------------------------------------------------------------------------

/**
 * 想定DOM:
 *   ul.booth_list > li
 *     h4.booth_name > span      … "A-1"
 *     h4.booth_name (残りテキスト) … "偽犬"
 *     p.booth_img img[src]
 *     .booth_add span.day_0814  … 参加日（存在する日のみ）
 *     ul.booth_member > li
 *       p.member_name
 *       p.member_link a[href]
 */
export function parseCreatorsMarket(html: string, venue: Venue): Creator[] {
  const $ = cheerio.load(html);
  const allDays = VENUE_META[venue].days;
  const creators: Creator[] = [];

  $('ul.booth_list > li').each((_, li) => {
    const $li = $(li);
    const $name = $li.find('h4.booth_name').first();
    if ($name.length === 0) return; // 注意書きの li などを飛ばす

    const boothId = tidy($name.find('span').first().text());
    // span を取り除いた残りがサークル名
    const $nameClone = $name.clone();
    $nameClone.find('span').remove();
    const circleName = tidy($nameClone.text());
    if (!boothId && !circleName) return;

    const { line, boothNo } = parseBoothId(boothId);

    const logoUrl = toAbsoluteUrl($li.find('p.booth_img img').first().attr('src')) ?? null;

    const days: string[] = [];
    $li.find('.booth_add span[class]').each((__, sp) => {
      for (const cls of ($(sp).attr('class') ?? '').split(/\s+/)) {
        const iso = dayClassToIso(cls);
        if (iso && !days.includes(iso)) days.push(iso);
      }
    });
    days.sort();

    const members: Member[] = [];
    $li.find('ul.booth_member > li').each((__, m) => {
      const $m = $(m);
      const name = tidy($m.find('p.member_name').first().text());
      const links: MemberLink[] = [];
      $m.find('p.member_link a[href]').each((___, a) => {
        const href = $(a).attr('href');
        if (!href) return;
        const abs = toAbsoluteUrl(href);
        if (!abs) return;
        links.push({ kind: classifyLink(abs), url: abs, label: tidy($(a).text()) });
      });
      if (name || links.length > 0) members.push({ name, links });
    });

    const xHandles: string[] = [];
    for (const m of members) {
      for (const l of m.links) {
        if (l.kind !== 'x') continue;
        const h = normalizeXHandle(l.url);
        if (h && !xHandles.includes(h)) xHandles.push(h);
      }
    }

    creators.push({
      // ID は全件揃ってから振り直す（共有ブースを検出するため）
      id: '',
      venue,
      kind: 'creators-market',
      boothId: boothId || null,
      line,
      boothNo,
      circleName,
      logoUrl,
      // 日別アイコンが取れなければ全日参加として扱う（表示から漏らさない側に倒す）
      days: days.length > 0 ? days : [...allDays],
      members,
      xHandles,
      note: null,
    });
  });

  const ids = assignIds(venue, creators);
  return creators.map((c, i) => ({ ...c, id: ids[i]! }));
}

// ---------------------------------------------------------------------------
// 出展ブース（企業・団体）
// ---------------------------------------------------------------------------

/**
 * 想定DOM:
 *   ul.sponsor_booth_detail > li[id^="spo_"]
 *     h3.booth_name > span   … "A1"（"ガチャ" や空文字もある）
 *     h3.booth_name (残り)   … "CRECO　株式会社ヒューネット"
 *     p.booth_img img[src]
 *     div.booth_text         … 説明文と外部リンク
 *
 * 出展ブースには日別アイコンが無いので全日参加として扱う。
 */
export function parseSponsors(html: string, venue: Venue): Creator[] {
  const $ = cheerio.load(html);
  const allDays = VENUE_META[venue].days;
  const creators: Creator[] = [];

  $('ul.sponsor_booth_detail > li').each((_, li) => {
    const $li = $(li);
    const $name = $li.find('h3.booth_name').first();
    if ($name.length === 0) return;

    const boothId = tidy($name.find('span').first().text());
    const $nameClone = $name.clone();
    $nameClone.find('span').remove();
    const circleName = tidy($nameClone.text());
    if (!circleName) return;

    const { line, boothNo } = parseBoothId(boothId);
    const logoUrl = toAbsoluteUrl($li.find('p.booth_img img').first().attr('src')) ?? null;

    const $text = $li.find('div.booth_text').first();
    const links: MemberLink[] = [];
    $text.find('a[href]').each((__, a) => {
      const href = $(a).attr('href');
      if (!href) return;
      const abs = toAbsoluteUrl(href);
      if (!abs) return;
      links.push({ kind: classifyLink(abs), url: abs, label: tidy($(a).text()) });
    });

    // 説明文だけ抜く（リンクのラベルを本文に混ぜない）
    const $textClone = $text.clone();
    $textClone.find('a').remove();
    const note = tidy($textClone.text()) || null;

    const xHandles: string[] = [];
    for (const l of links) {
      if (l.kind !== 'x') continue;
      const h = normalizeXHandle(l.url);
      if (h && !xHandles.includes(h)) xHandles.push(h);
    }

    creators.push({
      // ID は全件揃ってから振り直す（クリエイターズマーケットと同じ方式）
      id: '',
      venue,
      kind: 'sponsor',
      boothId: boothId || null,
      line,
      boothNo,
      circleName,
      logoUrl,
      days: [...allDays],
      members: links.length > 0 ? [{ name: '', links }] : [],
      xHandles,
      note,
    });
  });

  const ids = assignIds(venue, creators, '-sponsor');
  return creators.map((c, i) => ({ ...c, id: ids[i]! }));
}

// ---------------------------------------------------------------------------
// 並び順
// ---------------------------------------------------------------------------

/** 列 → 番号の昇順。非定型IDは末尾へ */
export function compareByBooth(a: Creator, b: Creator): number {
  const al = a.line ?? '￿';
  const bl = b.line ?? '￿';
  if (al !== bl) return al < bl ? -1 : 1;
  const an = a.boothNo ?? Number.MAX_SAFE_INTEGER;
  const bn = b.boothNo ?? Number.MAX_SAFE_INTEGER;
  if (an !== bn) return an - bn;
  return a.circleName.localeCompare(b.circleName, 'ja');
}
