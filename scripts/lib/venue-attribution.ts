/**
 * 「この投稿はどの会場・どの日のお品書きか」を確定する。
 *
 * 方針: **証明できたものだけ載せる**。
 * キーワードの重み付けで「たぶん大阪だろう」と推測すると、
 *  - 終了済みの浜松のお品書きが大阪ページに出る
 *  - 東京専用のお品書きが大阪ページに出る
 * といった誤りが必ず混ざる。閲覧者は別会場の品揃えを見て会場へ行くことになる。
 *
 * そこで判定は「積極的な証明」だけを認め、証明できなければ公開しない。
 * 公開されている全件が正しいことは、この関数が返す provenVenues が
 * 空でないことと同値になる。
 *
 * 証明の手段（強い順）:
 *  1. text-booth  … 本文に「大阪 D-06」のように会場名と公式ブース番号が揃っている
 *  2. text-venue  … 本文に会場名が明示されている（ブース番号なし）
 *  3. sole-venue  … 作者がマジミラ2026で1会場にしか出ておらず、他会場の可能性がない
 *  4. image       … お品書き画像から会場・ブース・日付を読み取った（別モジュール）
 */

import type {
  AttributionSource,
  RefVenue,
  Venue,
  VenueAttribution,
} from './types';
import { REF_VENUES, REF_VENUE_META, VENUES } from './types';

/** 作者の公式出展情報（会場ごとのブース番号と参加日） */
export type OfficialEntry = {
  venue: RefVenue;
  boothId: string | null;
  days: string[];
};

export type OfficialByHandle = Map<string, OfficialEntry[]>;

// ---------------------------------------------------------------------------
// 表記ゆれの正規化
// ---------------------------------------------------------------------------

/** 全角英数・記号を半角に寄せる。ブース番号の表記ゆれを吸収する */
export function normalizeText(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑–—−ー－―]/g, '-')
    .replace(/[［【〔]/g, '[')
    .replace(/[］】〕]/g, ']')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')');
}

/** "A-05" も "A5" も "A-5" に揃える */
export function normalizeBooth(raw: string): string | null {
  const m = /^([A-Za-z])\s*-?\s*0*(\d{1,2})$/.exec(normalizeText(raw).trim());
  if (!m) return null;
  return `${m[1]!.toUpperCase()}-${Number(m[2])}`;
}

// ---------------------------------------------------------------------------
// 本文の走査
// ---------------------------------------------------------------------------

type Marker =
  | { kind: 'venue'; venue: RefVenue; index: number; text: string }
  | { kind: 'booth'; booth: string; index: number; text: string }
  | { kind: 'date'; month: number; day: number; index: number; text: string };

/** 会場名・ブース番号・日付を出現位置つきで拾う */
export function scanMarkers(rawText: string): Marker[] {
  const text = normalizeText(rawText);
  const markers: Marker[] = [];

  for (const v of REF_VENUES) {
    for (const alias of REF_VENUE_META[v].aliases) {
      let from = 0;
      for (;;) {
        const i = text.indexOf(alias, from);
        if (i < 0) break;
        markers.push({ kind: 'venue', venue: v, index: i, text: alias });
        from = i + alias.length;
      }
    }
  }

  // ブース番号: A-1 / A1 / [A-1] / 「A-1」など。
  // 日付(7/26)や価格(2000円)を誤って拾わないよう、直前が数字・スラッシュでないこと。
  const boothRe = /(?<![0-9/])([A-Ga-g])\s*-?\s*(\d{1,2})(?![0-9])/g;
  for (const m of text.matchAll(boothRe)) {
    const booth = normalizeBooth(`${m[1]}-${m[2]}`);
    if (booth) markers.push({ kind: 'booth', booth, index: m.index, text: m[0] });
  }

  // 日付: 7/26, 8月15日, 8/14(金)
  const dateRe = /(\d{1,2})\s*[/月]\s*(\d{1,2})/g;
  for (const m of text.matchAll(dateRe)) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      markers.push({ kind: 'date', month, day, index: m.index, text: m[0] });
    }
  }

  return markers.sort((a, b) => a.index - b.index);
}

/**
 * 会場名で本文を区切り、それぞれの区間に属するブース番号と日付を集める。
 *
 * 実データの書き方（すべてこの区切りで扱える）:
 *   「浜松 7/26(日) のみ "C-10"  大阪 8/15.16(土日) "G-13"」
 *   「大阪：8/14~8/16 場所【G-5】 東京：8/29~8/30 場所【C-26】」
 *   「浜松【B-6】 東京【C-19】」
 */
export type VenueSegment = {
  venue: RefVenue;
  booths: string[];
  dates: { month: number; day: number }[];
};

export function segmentByVenue(rawText: string): {
  segments: VenueSegment[];
  /** どの会場区間にも属さないブース番号（会場名が本文に無い場合など） */
  looseBooths: string[];
  mentionedVenues: RefVenue[];
} {
  const markers = scanMarkers(rawText);
  const venueMarkers = markers.filter((m) => m.kind === 'venue');

  const mentionedVenues = [...new Set(venueMarkers.map((m) => m.venue))];

  if (venueMarkers.length === 0) {
    return {
      segments: [],
      looseBooths: [
        ...new Set(markers.filter((m) => m.kind === 'booth').map((m) => m.booth)),
      ],
      mentionedVenues: [],
    };
  }

  // 同じ会場名が連続する場合はひとつの区間にまとめる
  const bounds: { venue: RefVenue; start: number; end: number }[] = [];
  for (let i = 0; i < venueMarkers.length; i++) {
    const cur = venueMarkers[i]!;
    const prev = bounds[bounds.length - 1];
    if (prev && prev.venue === cur.venue) {
      prev.end = venueMarkers[i + 1]?.index ?? Number.MAX_SAFE_INTEGER;
      continue;
    }
    bounds.push({
      venue: cur.venue,
      start: cur.index,
      end: venueMarkers[i + 1]?.index ?? Number.MAX_SAFE_INTEGER,
    });
  }

  const segments: VenueSegment[] = bounds.map((b) => ({
    venue: b.venue,
    booths: [],
    dates: [],
  }));

  const claimed = new Set<number>();
  for (const m of markers) {
    if (m.kind === 'venue') continue;
    const bi = bounds.findIndex((b) => m.index >= b.start && m.index < b.end);
    if (bi < 0) continue;
    claimed.add(m.index);
    if (m.kind === 'booth') {
      if (!segments[bi]!.booths.includes(m.booth)) segments[bi]!.booths.push(m.booth);
    } else {
      segments[bi]!.dates.push({ month: m.month, day: m.day });
    }
  }

  const looseBooths = [
    ...new Set(
      markers
        .filter((m) => m.kind === 'booth' && !claimed.has(m.index))
        .map((m) => (m as { booth: string }).booth),
    ),
  ];

  // 同じ会場が複数区間に分かれた場合はまとめる
  const merged = new Map<RefVenue, VenueSegment>();
  for (const s of segments) {
    const cur = merged.get(s.venue);
    if (!cur) {
      merged.set(s.venue, { ...s });
      continue;
    }
    for (const b of s.booths) if (!cur.booths.includes(b)) cur.booths.push(b);
    cur.dates.push(...s.dates);
  }

  return { segments: [...merged.values()], looseBooths, mentionedVenues };
}

// ---------------------------------------------------------------------------
// 帰属の確定
// ---------------------------------------------------------------------------

function isoDate(month: number, day: number): string {
  return `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 区間内の日付のうち、その会場の公式開催日に含まれるものだけを採用する */
function resolveDays(
  venue: Venue,
  segDates: { month: number; day: number }[],
  officialDays: string[],
): string[] | null {
  if (segDates.length === 0) return null;
  const wanted = new Set(segDates.map((d) => isoDate(d.month, d.day)));
  const hit = officialDays.filter((d) => wanted.has(d));
  // 本文の日付がその会場の開催日と1つも噛み合わないなら、
  // それは別会場の日付。日付での絞り込みは行わない。
  return hit.length > 0 ? hit : null;
}

export type AttributeInput = {
  text: string;
  handle: string;
  /**
   * 画像の代替テキスト。クリエイターが自分で書いており、
   * 「大阪 D-06 お品書き」のように会場が入っていることがある。
   * 本文と同じ扱いで判定に使う（追加コストなしで確定率が上がる）。
   */
  altTexts?: (string | null)[];
  /** 作者の公式出展情報（浜松を含む） */
  official: OfficialEntry[];
};

/**
 * 「◯◯のお品書き」— 本文が添付画像を特定の会場に紐づけている箇所を拾う。
 *
 * 実データ:
 *   「浜松 : 7/26(日) C-2 / 東京 : 8/29(土),30(日) A-26 … まずは浜松のお品書き👇」
 * この投稿は東京 A-26 を正しく証明するが、**貼られている画像は浜松のお品書き**。
 * 東京ページに載せると、東京では並ばない品揃えを見せることになる。
 *
 * 会場名と「お品書き」の間に許すのは、その会場を修飾する短い語だけ
 * （の・：・【B-27】・A-26・7/26(日)・空白）。
 * 「東京 C-18 「錦市場」のおしながき」のように別の語が挟まる場合は
 * 紐づけと見なさない（サークル名にかかっているだけかもしれない）。
 */
// normalizeText が【】→[]、（）→() に正規化した後の形で書く。
// 「」は含めない — 「東京 C-18 「錦市場」のおしながき」の
// 「の」はサークル名にかかっているので紐づけと見なさない。
//
// 他の会場名も連結子に含める。「大阪東京のお品書きです」は
// 大阪と東京の両方に紐づく（片方だけ拾うと、もう片方の会場ページで
// 「別会場のお品書き」と誤判定してしまう）。
const VENUE_ALIAS_ALT = REF_VENUES.flatMap((v) => REF_VENUE_META[v].aliases)
  .map((a) => escapeRegExp(normalizeText(a)))
  .sort((a, b) => b.length - a.length)
  .join('|');

// 会場名とお品書きの間に挟まる定型語も連結子に含める。
// 「HAMAMATSU会場 クリエイターズマーケット お品書きになります」を1つの紐づけとして拾う。
const BOUND_FILLER = String.raw`会場|クリエイターズマーケット|クリエイターズ|マーケット|ズマケ|クリマ|参加|出展`;

const BOUND_CONNECTOR = String.raw`(?:[のはも:,、・&+\s]|\[[^\]]{0,12}\]|\([^)]{0,10}\)|[A-Ga-g]\s*-?\s*\d{1,2}|\d{1,2}\s*/\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日|のみ|限定|${BOUND_FILLER}|${VENUE_ALIAS_ALT})*`;

export function imageBoundVenues(rawText: string): RefVenue[] {
  const text = normalizeText(rawText);
  const found = new Set<RefVenue>();
  for (const meta of Object.values(REF_VENUE_META)) {
    for (const alias of meta.aliases) {
      const re = new RegExp(
        `${escapeRegExp(normalizeText(alias))}${BOUND_CONNECTOR}(?:お品書き|おしながき|お品書|品書き)`,
      );
      if (re.test(text)) {
        found.add(meta.venue);
        break;
      }
    }
  }
  return REF_VENUES.filter((v) => found.has(v));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 本文と公式データから会場帰属を確定する。
 * 確定できなければ provenVenues は空になり、その投稿は公開されない。
 */
export function attributeFromText(input: AttributeInput): VenueAttribution {
  // 代替テキストも本文と同じ材料として扱う。区切り記号を挟んで、
  // 本文末尾の会場名が代替テキストのブース番号を巻き込まないようにする。
  const alt = (input.altTexts ?? []).filter((t): t is string => Boolean(t && t.trim()));
  const combined = alt.length > 0 ? [input.text, ...alt].join('\n \n') : input.text;
  const { segments, looseBooths, mentionedVenues } = segmentByVenue(combined);
  const evidence: string[] = [];
  const proven = new Set<Venue>();
  const daysByVenue: Partial<Record<Venue, string[]>> = {};
  let source: AttributionSource = 'unresolved';
  /**
   * 本文が具体的なブース番号を書いているのに公式と食い違った状態。
   * 本文が何か特定のことを主張していて、それが検証できていない以上、
   * 消去法のような弱い推論で穴埋めしてはいけない。
   */
  let hasConflict = false;

  const officialOf = (v: RefVenue): OfficialEntry[] =>
    input.official.filter((o) => o.venue === v);

  // --- 1. 会場名 + 公式ブース番号の一致（最も強い） ---
  for (const seg of segments) {
    if (!VENUES.includes(seg.venue as Venue)) continue;
    const venue = seg.venue as Venue;
    const entries = officialOf(venue);
    if (entries.length === 0) continue;

    const officialBooths = entries
      .map((e) => (e.boothId ? normalizeBooth(e.boothId) : null))
      .filter((b): b is string => b !== null);

    const matched = seg.booths.filter((b) => officialBooths.includes(b));
    if (matched.length > 0) {
      proven.add(venue);
      source = 'text-booth';
      evidence.push(
        `本文の「${REF_VENUE_META[venue].label} ${matched.join(',')}」が公式のブース番号と一致`,
      );
      const days = resolveDays(venue, seg.dates, entries.flatMap((e) => e.days));
      if (days) {
        daysByVenue[venue] = days;
        evidence.push(`${REF_VENUE_META[venue].label}の対象日: ${days.join(', ')}`);
      }
      continue;
    }

    // 会場名の区間にブース番号があるのに公式と食い違う場合は確定しない。
    // 他人のブースを紹介している、書き間違い、などの可能性がある。
    if (seg.booths.length > 0) {
      hasConflict = true;
      evidence.push(
        `本文の「${REF_VENUE_META[venue].label} ${seg.booths.join(',')}」は公式のブース番号(${officialBooths.join(',') || 'なし'})と一致しない`,
      );
      continue;
    }

    // --- 2. 会場名のみ（ブース番号なし） ---
    //
    // これは証明にしない。実データで
    //   「マジミラ浜松ありがとうございました！次は大阪でお待ちしてます」
    // のようなお礼の投稿が大阪のお品書きとして公開されていた。
    // 会場名は未来の予定・近況報告・在庫の話にも出てくるので、
    // 「その会場のお品書きである」ことの証明にならない。
    //
    // ただし日付の絞り込みには使えるし、レビューの手がかりにはなるので
    // 根拠としては残す。
    evidence.push(
      `本文に「${REF_VENUE_META[venue].label}」の記載があるが、ブース番号が無いため確定しない`,
    );
    const days = resolveDays(venue, seg.dates, entries.flatMap((e) => e.days));
    if (days) {
      daysByVenue[venue] = days;
    }
  }

  // --- 3. 会場名が無くても、公式ブース番号が一意に一致すれば確定 ---
  if (proven.size === 0 && looseBooths.length > 0) {
    for (const venue of VENUES) {
      const entries = officialOf(venue);
      const officialBooths = entries
        .map((e) => (e.boothId ? normalizeBooth(e.boothId) : null))
        .filter((b): b is string => b !== null);
      const matched = looseBooths.filter((b) => officialBooths.includes(b));
      if (matched.length === 0) continue;

      // 他会場の公式ブース番号とも一致してしまう場合は曖昧なので確定しない
      const ambiguous = REF_VENUES.filter((other) => other !== venue).some((other) =>
        officialOf(other)
          .map((e) => (e.boothId ? normalizeBooth(e.boothId) : null))
          .some((b) => b !== null && matched.includes(b)),
      );
      if (ambiguous) {
        evidence.push(
          `ブース番号 ${matched.join(',')} は複数会場で同じなので会場を特定できない`,
        );
        continue;
      }
      proven.add(venue);
      source = 'text-booth';
      evidence.push(`ブース番号 ${matched.join(',')} が${REF_VENUE_META[venue].label}の公式番号と一致（他会場と重複なし）`);
    }
  }

  // --- 4. 消去法: 作者がマジミラ2026で1会場にしか出ていない ---
  // 本文とデータが食い違っている場合は使わない（弱い推論で穴埋めしない）
  if (proven.size === 0 && !hasConflict) {
    const venuesOfCreator = [...new Set(input.official.map((o) => o.venue))];
    if (venuesOfCreator.length === 1) {
      const only = venuesOfCreator[0]!;
      // 本文が別会場に言及しているなら消去法は使えない
      const mentionsOther = mentionedVenues.some((v) => v !== only);
      if (VENUES.includes(only as Venue) && !mentionsOther) {
        proven.add(only as Venue);
        source = 'sole-venue';
        evidence.push(
          `この作者はマジカルミライ2026で${REF_VENUE_META[only].label}にしか出展しておらず、本文も他会場に言及していない`,
        );
      } else if (!VENUES.includes(only as Venue)) {
        evidence.push(
          `この作者は${REF_VENUE_META[only].label}にしか出展していない（サイトの対象外）`,
        );
      }
    }
  }

  // --- 5. 「◯◯のお品書き」で画像が別会場に紐づいているものを外す ---
  // 会場自体は正しく証明できていても、貼られている画像が別会場のものなら、
  // その会場のページに載せてはいけない。
  const bound = imageBoundVenues(combined);
  if (bound.length > 0) {
    for (const v of [...proven]) {
      if (!bound.includes(v)) {
        proven.delete(v);
        delete daysByVenue[v];
        evidence.push(
          `本文が画像を「${bound.map((b) => REF_VENUE_META[b].label).join('・')}のお品書き」と書いており、${REF_VENUE_META[v].label}の品揃えとは限らない`,
        );
      }
    }
  }

  if (proven.size === 0 && evidence.length === 0) {
    evidence.push('本文に会場名・ブース番号のいずれも無く、会場を特定できない');
  }

  const otherVenues = mentionedVenues.filter(
    (v) => !VENUES.includes(v as Venue) || !proven.has(v as Venue),
  );

  return {
    provenVenues: VENUES.filter((v) => proven.has(v)),
    daysByVenue,
    otherVenues,
    source: proven.size > 0 ? source : 'unresolved',
    evidence,
  };
}

/** 公式データから「ハンドル → 出展情報」の索引を作る */
export function buildOfficialIndex(
  entries: { venue: RefVenue; boothId: string | null; days: string[]; xHandles: string[] }[],
): OfficialByHandle {
  const map: OfficialByHandle = new Map();
  for (const e of entries) {
    for (const h of e.xHandles) {
      const k = h.toLowerCase();
      const arr = map.get(k) ?? [];
      arr.push({ venue: e.venue, boothId: e.boothId, days: e.days });
      map.set(k, arr);
    }
  }
  return map;
}
