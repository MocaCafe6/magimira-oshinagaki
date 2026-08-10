/**
 * お品書き画像から読み取った内容を、公式データと照合して会場帰属に変換する。
 *
 * 「画像にこう書いてあった」だけでは採用しない。必ず公式の出展記録
 * （その作者がその会場に出ているか／ブース番号が一致するか）と突き合わせ、
 * 通ったものだけを確定とする。読み取り側が API でも人でも同じ判定を通す。
 */
import {
  REF_VENUE_META,
  VENUES,
  type RefVenue,
  type Venue,
  type VenueAttribution,
} from './types';
import { normalizeBooth, type OfficialEntry } from './venue-attribution';

/** 画像から読み取った1会場ぶんの記載 */
export type VenueRead = {
  venue: RefVenue | 'unknown';
  boothId: string | null;
  /** YYYY-MM-DD */
  dates: string[];
};

export type ImageRead = {
  /** この画像が頒布物の一覧（お品書き）か */
  isOshinagaki: boolean;
  /**
   * 誰が読んだか。`isOshinagaki: false` をどれだけ信じてよいかが変わる。
   *
   * 'ocr' … tesseract。装飾的な日本語のポスターに弱く、実測で本物のお品書き
   *          15枚のうち10枚を読み落とした。**陰性は信用しない**
   *          （「お品書きではない」ではなく「読めなかった」として扱う）
   * 'vision' … Claude API。画像を実際に理解するので陰性も信用してよい
   * 'manual' … 人が見た。同上
   *
   * 省略時は 'manual' 扱い（手で書いた `data/image-reads.json` との互換）。
   */
  readBy?: 'ocr' | 'vision' | 'manual';
  /**
   * `isOshinagaki: false` を信じてよいか。
   *
   * OCR の陰性は原則として信用しないが、例外がある。公式出店者一覧ページの
   * スクリーンショットには「サークルメンバー」という文字列が入っていて、
   * これはお品書きにはまず出てこない。読めた時点で
   * 「これは公式ページの画面写真であってお品書きではない」と断定できる。
   * そういう**積極的な否定の証拠**があるときだけ true にする。
   */
  negativeIsReliable?: boolean;
  /**
   * これがマジカルミライのお品書きだと確認できるか。
   * 画像のロゴ・イベント名でも、投稿本文の明示でもよい。
   * 他イベント（ボーマス・音けっと・COMITIA・プロセカ等）のお品書きを
   * 会場無指定で全会場に配ってしまわないための歯止め。
   */
  isMagimira?: boolean;
  /**
   * 会場の指定があるか。
   *
   * 'specific' … 画像が会場を名指ししている（venues に入れる）
   * 'event-wide' … マジカルミライのお品書きだが会場を限定していない。
   *   実データ: 千本桜15周年のグッズ一覧は「マジカルミライ2026」ロゴ入りで
   *   Goods List 1〜3 に分かれているが、会場名もブース番号も無い。
   *   会場を限定していない以上、その作者が出る全会場に並ぶ。
   *
   *   画像だけでなく**投稿本文も**会場を限定していないことが条件。
   *   実データ: MINO-U の「MENU」画像には会場の記載が無いが、本文が
   *   「7/26(日) マジカルミライ2026 クリエイターズマーケット【B-7】」と
   *   浜松に限定している。この場合は 'specific' + 浜松として扱う。
   */
  venueScope?: 'specific' | 'event-wide';
  venues: VenueRead[];
  notes?: string | null;
};

export type ImageVerdict = {
  attribution: VenueAttribution;
  /** 画像の記載が公式と食い違った（誤読か、他人のブースの紹介） */
  mismatched: boolean;
};

export function verifyImageRead(read: ImageRead, official: OfficialEntry[]): ImageVerdict {
  const proven: Venue[] = [];
  const daysByVenue: Partial<Record<Venue, string[]>> = {};
  const otherVenues: RefVenue[] = [];
  const evidence: string[] = [];
  let mismatched = false;

  // お品書きでない画像（イベント写真、告知バナー等）は、
  // 会場が読めても「その会場のお品書き」ではない。
  // source:'image' は curation のお品書き判定を通らないので、ここで止める。
  if (!read.isOshinagaki) {
    evidence.push('画像は頒布物の一覧（お品書き）ではないと判定');
    return {
      attribution: {
        provenVenues: [],
        daysByVenue: {},
        otherVenues: [],
        source: 'unresolved',
        evidence,
      },
      mismatched: false,
    };
  }

  // 会場を限定していないイベント全体のお品書き。
  // その作者が公式に出展している対象会場すべてに並ぶ。
  // マジカルミライのお品書きだと確認できている場合にだけ使う
  // （他イベントのお品書きを全会場に配ってしまわないため）。
  if (read.venueScope === 'event-wide') {
    if (!read.isMagimira) {
      evidence.push('会場の指定が無く、マジカルミライのお品書きだとも確認できない');
      return {
        attribution: {
          provenVenues: [],
          daysByVenue: {},
          otherVenues: [],
          source: 'unresolved',
          evidence,
        },
        mismatched: false,
      };
    }
    const inScope = VENUES.filter((v) => official.some((o) => o.venue === v));
    for (const v of inScope) {
      proven.push(v);
    }
    for (const o of official) {
      if (!VENUES.includes(o.venue as Venue)) otherVenues.push(o.venue);
    }
    evidence.push(
      inScope.length > 0
        ? `マジカルミライのお品書きだが会場を限定していないため、公式の出展先である${inScope
            .map((v) => REF_VENUE_META[v].label)
            .join('・')}すべてに適用`
        : 'マジカルミライのお品書きだが、公式の出展記録が対象会場に無い',
    );
    if (read.notes) evidence.push(`読み取りメモ: ${read.notes}`);
    return {
      attribution: {
        provenVenues: VENUES.filter((v) => proven.includes(v)),
        daysByVenue: {},
        otherVenues: [...new Set(otherVenues)],
        source: proven.length > 0 ? 'image' : 'unresolved',
        evidence,
      },
      mismatched: false,
    };
  }

  for (const v of read.venues) {
    if (v.venue === 'unknown') continue;
    const venue = v.venue;

    if (!VENUES.includes(venue as Venue)) {
      otherVenues.push(venue);
      evidence.push(`画像に「${REF_VENUE_META[venue].label}」の記載（対象外）`);
      continue;
    }

    const target = venue as Venue;
    const entries = official.filter((o) => o.venue === target);
    const officialBooths = entries
      .map((e) => (e.boothId ? normalizeBooth(e.boothId) : null))
      .filter((b): b is string => b !== null);
    const readBooth = v.boothId ? normalizeBooth(v.boothId) : null;

    // 公式データとの照合。ここを通らないものは確定しない。
    if (readBooth && officialBooths.includes(readBooth)) {
      proven.push(target);
      evidence.push(
        `画像の「${REF_VENUE_META[target].label} ${readBooth}」が公式のブース番号と一致`,
      );
    } else if (readBooth) {
      // 会場名は合っていないが、ブース番号がその作者の**別の会場の**
      // 公式番号と一意に一致する場合は、会場名の書き間違いとみなす。
      //
      // 実データ: Re:nG のお品書きは見出しに
      //   「C-10（浜松）/ B-06（東京）/ B-03（東京）」
      // と東京を2回書いている。公式では B-6 が大阪、B-3 が東京。
      // 作者自身の誤記。これを「一致しない」で捨てていたため、
      // 大阪のお品書きを丸ごと取りこぼしていた。
      //
      // 番号は作者自身のお品書きに印字されたもので、公式の出展記録と
      // 一意に一致する。他会場と重複していれば使わないので、
      // 「どの会場か分からない」ものを推測で埋めることにはならない。
      const elsewhere = VENUES.filter((other) =>
        official.some(
          (o) =>
            o.venue === other &&
            o.boothId &&
            normalizeBooth(o.boothId) === readBooth,
        ),
      );
      if (elsewhere.length === 1 && !proven.includes(elsewhere[0]!)) {
        const fixed = elsewhere[0]!;
        proven.push(fixed);
        evidence.push(
          `画像は「${REF_VENUE_META[target].label} ${readBooth}」と書いているが、` +
            `${readBooth} は公式では${REF_VENUE_META[fixed].label}のブース番号（会場名の書き間違いとみなす）`,
        );
        continue;
      }
      mismatched = true;
      evidence.push(
        `画像の「${REF_VENUE_META[target].label} ${readBooth}」は公式(${officialBooths.join(',') || 'なし'})と一致しない`,
      );
      continue;
    } else if (entries.length > 0) {
      // ブース番号は読めなかったが会場名は明記されており、
      // その作者が実際にその会場に出展している
      proven.push(target);
      evidence.push(
        `画像に「${REF_VENUE_META[target].label}」の明記があり、公式にも出展記録がある`,
      );
    } else {
      evidence.push(`画像に「${REF_VENUE_META[target].label}」とあるが、公式の出展記録が無い`);
      continue;
    }

    // 日付は会場の開催日に含まれるものだけ採用
    const venueDays = new Set(REF_VENUE_META[target].days);
    const days = v.dates.filter((d) => venueDays.has(d));
    if (days.length > 0) {
      daysByVenue[target] = days;
      evidence.push(`画像の日付: ${days.join(', ')}`);
    }
  }

  if (read.notes) evidence.push(`読み取りメモ: ${read.notes}`);
  if (proven.length === 0 && evidence.length === 0) {
    evidence.push('画像に会場の記載が無い');
  }

  return {
    attribution: {
      provenVenues: VENUES.filter((v) => proven.includes(v)),
      daysByVenue,
      otherVenues: [...new Set(otherVenues)],
      source: proven.length > 0 ? 'image' : 'unresolved',
      evidence,
    },
    mismatched,
  };
}
