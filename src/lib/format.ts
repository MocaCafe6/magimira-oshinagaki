/**
 * 表示用の整形。**タイムゾーンに依存させない**。
 *
 * getFullYear / getHours などは実行環境のタイムゾーンで結果が変わる。
 * このサイトは静的書き出し（ビルドは UTC）なので、閲覧者の端末が JST だと
 * サーバが書いた文字列と client の描画が食い違い、React が
 * ハイドレーション不一致（error #418）を投げる。本番で実際に出ていた。
 *
 * イベントは日本国内で、閲覧者の端末に合わせる必要がない。
 * 固定で Asia/Tokyo にすれば、どこで実行しても同じ文字列になる。
 */

const JST_DATETIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 「2026/8/13 21:05」。区切りは環境差が出ないよう自前で組む */
export function formatDateTimeJst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = new Map(JST_DATETIME.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.get('year')}/${p.get('month')}/${p.get('day')} ${p.get('hour')}:${p.get('minute')}`;
}

/**
 * 「8/15(土)」。
 * 会期の日付は data 側で 'YYYY-MM-DD' の文字列として持っているので、
 * Date を経由せず文字列のまま扱う。UTC 指定で Date を作る手もあるが、
 * 経由しないほうが取り違えようがない。
 */
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

export function formatEventDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const wd = WEEKDAY[new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay()];
  return `${Number(mo)}/${Number(d)}(${wd})`;
}
