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

/**
 * URL と @ハンドルを伏せる。
 *
 * 実データ: OZaKKa（浜松の販売実況）が
 *   「#マジカルミライ2026 HAMAMATSU 完売情報／…▽ http://shop.ozakka.tokyo」
 * を投稿していた。ドメインの "tokyo" とハンドル名 "OZaKKa_tokyo" を
 * 会場名として拾い、浜松の実況が東京のページに出ていた。
 * URL やハンドルに含まれる地名は会場を指していない。
 */
function maskUrlsAndHandles(s: string): string {
  return s
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[\w.-]+\.(com|net|jp|tokyo|shop|co|io|me|link)\b/gi, ' ')
    .replace(/@\w+/g, ' ');
}

/** 会場名・ブース番号・日付を出現位置つきで拾う */
/**
 * マジカルミライの会場ではない都市と並べて書かれている地名か。
 *
 * 別の公演ツアーの開催地を列挙しているだけで、マジカルミライの会場を
 * 指していない。実データ:
 *   「「マジカルミライ 2026」浜松最終日🔥 初音ミクシンフォニーブース出展中🎻
 *     初音ミクシンフォニー2026【札幌、東京公演】公式グッズを販売‼︎」
 * これは浜松のブースからの実況で、「東京」は初音ミクシンフォニーの
 * 公演地。ここを東京会場と読むと、浜松の投稿が東京のページに出る。
 *
 * マジカルミライ2026 の会場は浜松・大阪・東京しかないので、
 * 札幌などが同じ並びに出てきたら、その並びは別のイベントの話である。
 */
const NON_VENUE_CITY = '札幌|名古屋|福岡|仙台|広島|横浜|神戸|京都|沖縄|金沢|新潟|静岡';
const OTHER_TOUR_LIST_RE = new RegExp(`(?:${NON_VENUE_CITY})\\s*[、,・･/／と＆&]\\s*$`);

function isOtherTourCityList(text: string, index: number): boolean {
  return OTHER_TOUR_LIST_RE.test(text.slice(Math.max(0, index - 12), index));
}

export function scanMarkers(rawText: string): Marker[] {
  const text = normalizeText(maskUrlsAndHandles(rawText));
  const markers: Marker[] = [];

  for (const v of REF_VENUES) {
    for (const alias of REF_VENUE_META[v].aliases) {
      let from = 0;
      for (;;) {
        const i = text.indexOf(alias, from);
        if (i < 0) break;
        if (!isOtherTourCityList(text, i)) {
          markers.push({ kind: 'venue', venue: v, index: i, text: alias });
        }
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
//
// ⚠ normalizeText は長音符「ー」をハイフンに変換する（ブース番号の
//    表記ゆれ吸収のため）。ここも変換後の形で書かないと一致しない。
//    実際「クリエイターズマーケット」と書いていて拾えていなかった。
const BOUND_FILLER = normalizeText(
  '会場|クリエイターズマーケット|クリエイターズ|マーケット|ズマケ|クリマ|参加|出展',
);

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
/**
 * マジカルミライ以外の即売会の名前。
 *
 * これらが本文にあると、書かれている会場名がどちらのイベントのものか
 * 判別できない。実データ:
 *   「7/25(土)東京 #ボーマス63 7/26(日)浜松 #マジカルミライ2026 のお品書き」
 * の「東京」はボーマスの開催地であって、マジミラ東京ではない。
 */
const OTHER_EVENT_RE =
  /ボーマス|ボカロマスター|THE\s*VOC@?LOiD|音けっと|ガタケット|COMITIA|コミティア|コミケ|コミックマーケット|例大祭|文学フリマ|プロセカ|星に願いを|スパノヴァ|ぬいFes|M3(?![0-9])/i;

export function attributeFromText(input: AttributeInput): VenueAttribution {
  // 代替テキストも本文と同じ材料として扱う。区切り記号を挟んで、
  // 本文末尾の会場名が代替テキストのブース番号を巻き込まないようにする。
  const alt = (input.altTexts ?? []).filter((t): t is string => Boolean(t && t.trim()));
  const combined = alt.length > 0 ? [input.text, ...alt].join('\n \n') : input.text;
  const { segments, looseBooths, mentionedVenues } = segmentByVenue(combined);
  // 他イベントの名前があると、会場名がどちらのイベントのものか判別できない
  const mentionsOtherEvent = OTHER_EVENT_RE.test(combined);
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
    // 「マジカルミライ2026 OSAKA・TOKYO会場にて先行販売」のように、
    // 会場名は書くがブース番号は一度も書かないサークルがある
    // （企業ブースに多い）。番号を要求すると構造的に拾えない。
    //
    // 会場名が書かれていて、かつ公式にもその会場に出展しているなら、
    // それはその会場の頒布物の話とみなしてよい。
    //
    // ただし**他イベントの名前が本文にあるときは使わない**。
    //   「7/25(土)東京 #ボーマス63 7/26(日)浜松 #マジカルミライ2026 のお品書き」
    // の「東京」はボーマスの東京であって、マジミラ東京ではない。
    // 会場名がどのイベントに掛かっているか判別できないので確定しない。
    //
    // なお「浜松ありがとう！次は大阪で」のようなお礼の投稿は、
    // ここを通っても curation の isOshinagakiPost で落ちる。
    // また「浜松のお品書き」と本文が画像を紐づけている場合は
    // 後段の規則5で他会場を取り消す。
    if (mentionsOtherEvent) {
      evidence.push(
        `本文に「${REF_VENUE_META[venue].label}」の記載があるが、他イベントの名前も含むためどちらの会場か判別できない`,
      );
    } else {
      proven.add(venue);
      if (source === 'unresolved') source = 'text-venue';
      evidence.push(
        `本文に「${REF_VENUE_META[venue].label}」の記載があり、公式にも出展記録がある（ブース番号の記載は無し）`,
      );
    }
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

  // --- 4.5 イベント全体への告知（会場を限定していない） ---
  //
  // 実データ:
  //   「【鬱P新譜情報】マジカルミライクリエイターズマーケットにて新譜カセット
  //     テープ「H.M.1996」を頒布します。1000円です。…🚨浜松は26日(日)のみなので要注意！」
  // 「マジカルミライで頒布します」とだけ言っていて会場を限定していない。
  // 会場を限定していない以上、その作者が出展する全会場に並ぶ。
  //
  // 条件を絞って誤適用を防ぐ:
  //   - **会場名を一つも書いていない**
  //     書いてあれば、それが対象会場なら規則1・2が扱う。浜松なら浜松の話。
  //   - 他イベントの名前が無い
  //   - ブース番号を書いていない
  //     番号を書いているなら特定のブースの話であって、全体告知ではない。
  //     「お品書きです。C-8 でお待ちしています」で C-8 が複数会場にあるとき、
  //     全会場に適用してしまうのは誤り（どの会場か分からないのが正しい）。
  //
  // 「浜松と書いてあっても全会場の話かもしれない」を救おうとして、
  // 以前は「浜松限定」「浜松のお品書き」「浜松の販売情報」といった
  // 例外パターンを並べていた。これは破綻した。実際に漏れた4件:
  //   「和真パレットブースのお品書きを公開！…グラスクロスは浜松会場限定」
  //     → 「浜松会場限定」は /(浜松|HAMAMATSU)\s*限定/ に当たらない
  //   「HAMAMATSU 追加情報📢 物販に先行販売アイテムが追加！」（グッスマ）
  //   「マジミラ浜松最終日のある朝 やみくろさんはズマケにいます」
  //   「【鬱P新譜情報】…頒布します…🚨浜松は26日(日)のみなので要注意！」
  // いずれも浜松の話なのに大阪・東京の両ページへ出ていた。
  //
  // 上の鬱Pの投稿は「3会場すべての新譜情報だ」とも読める。だが
  // **読めるだけで証明はできない**。掲載する以上その会場のお品書きで
  // あることが確実でなければならず、確実でないものは載せない。
  // 大阪のお品書きが実際に投稿されればそちらで拾える。
  if (
    proven.size === 0 &&
    !hasConflict &&
    !mentionsOtherEvent &&
    mentionedVenues.length === 0 &&
    looseBooths.length === 0 &&
    segments.every((s) => s.booths.length === 0)
  ) {
    const inScope = VENUES.filter((v) => input.official.some((o) => o.venue === v));
    for (const v of inScope) proven.add(v);
    if (inScope.length > 0) {
      source = 'event-wide';
      evidence.push(
        `会場名を一つも書いていないマジカルミライの告知なので、公式の出展先である${inScope
          .map((v) => REF_VENUE_META[v].label)
          .join('・')}すべてに適用`,
      );
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

  const otherVenues = mentionedVenues.filter(
    (v) => !VENUES.includes(v as Venue) || !proven.has(v as Venue),
  );

  if (proven.size === 0 && evidence.length === 0) {
    // 表示対象外の会場（浜松）しか書かれていない投稿がここに来る。
    // 規則1が `VENUES.includes` で浜松の区間を飛ばすため根拠が一つも
    // 積まれず、以前は「会場名・ブース番号のいずれも無い」と記録していた。
    // 非掲載という結論は正しいが、根拠が事実と食い違っていた
    // （実際は「【マジミラ浜松】…D-9」と両方書かれている）。
    // 根拠は監査証跡なので、判定できなかったのか対象外だったのかを
    // 取り違えたまま残してはいけない。
    const outOfScope = otherVenues.filter((v) => !VENUES.includes(v as Venue));
    if (outOfScope.length > 0) {
      evidence.push(
        `本文が指しているのは${outOfScope
          .map((v) => REF_VENUE_META[v].label)
          .join('・')}のみで、掲載対象の会場ではない`,
      );
    } else {
      evidence.push('本文に会場名・ブース番号のいずれも無く、会場を特定できない');
    }
  }

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
