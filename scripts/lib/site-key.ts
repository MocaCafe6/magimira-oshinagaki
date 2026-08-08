/**
 * サイトURLを「同じ持ち主か」を比べるための鍵に変換する。
 *
 * X のプロフィールに書かれたリンクと、公式の出展者一覧に載っている
 * リンクを突き合わせてアカウントを特定する（match-x-by-site.ts）ために使う。
 */

/**
 * 誰でもページを作れる共有ドメイン。
 *
 * ここでホスト名だけを比べてはいけない。本人かどうかはパスにある。
 * 実際に誤検出した: かおなしレコード（和田たけあき）の公式リンクは
 * lit.link/wadatakeaki だが、lit.link/akitatchi を持つ別人（橘あき）の
 * アカウントを「lit.link が一致」として採ってしまった。
 * そのまま公開していれば、別人の投稿がかおなしレコードのブースの
 * お品書きとして出ていた。
 */
export const SHARED_HOSTS = new Set([
  'lit.link', 'linktr.ee', 'linktree.com', 'potofu.me', 'litlink.com',
  'karent.jp', 'booth.pm', 'thebase.in', 'base.shop', 'stores.jp', 'shop-pro.jp',
  'suzuri.jp', 'bandcamp.com', 'soundcloud.com', 'bigcartel.com',
  'note.com', 'pixiv.net', 'fanbox.cc', 'tumblr.com', 'blogspot.com',
  'youtube.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'x.com', 'twitter.com',
  'rakuten.co.jp', 'amazon.co.jp', 'nicovideo.jp',
]);

/**
 * ホスト名を潰す。www と、店舗用サブドメインの差を吸収する。
 * co.jp / ne.jp のような2階層TLDは3ラベルまで残す。
 */
export function baseHost(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const second = parts[parts.length - 2]!;
  const keep = ['co', 'ne', 'or', 'gr', 'ac', 'go', 'com', 'net', 'org'].includes(second) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/**
 * 照合の鍵。
 *
 * 自社ドメインならホスト名まででよい（パスの深さは持ち主と無関係）。
 * 共有ドメインは持ち主がどこに出るかがサービスによって違うので、
 * サブドメインもパスも落とさない:
 *   lit.link/wadatakeaki      … パス
 *   mayuro.booth.pm           … サブドメイン
 *   karent.jp/artist/pp000812 … パス（種別が1段挟まる）
 */
export function siteKey(url: string): string | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  const base = baseHost(u.hostname);
  if (!SHARED_HOSTS.has(base)) return base;
  const fullHost = u.hostname.toLowerCase().replace(/^www\./, '');
  const id = u.pathname.split('/').filter(Boolean).slice(0, 2).join('/').toLowerCase();
  return id ? `${fullHost}/${id}` : fullHost;
}
