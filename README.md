# マジミラお品書き一覧

マジカルミライ クリエイターズマーケットのお品書きを一覧で確認し、
お気に入りとメモを残せる非公式ツール。

**日程**

| 会場 | 日程 | 場所 | 規模 |
|---|---|---|---|
| 大阪 | 2026/8/14–16 | インテックス大阪 3・4号館 | A〜G列 95サークル + 出展ブース43 |
| 東京 | 2026/8/28–30 | 幕張メッセ 国際展示場 1・2・3ホール | A〜D列 119サークル + 出展ブース57 |

---

## 仕組み

```
[手元のPC]                                          [公開（静的ホスティング）]

npm run scrape-official ─┐  公式サイトのHTMLをパース
                         │
npm run x-login          │  サブアカウントで一度だけ手動ログイン
npm run crawl-x  ────────┼─→ data/*.json ──(next build)──→ out/ ─→ デプロイ
                         │                                   ├ 一覧・詳細・グッズ横断
npm run review           │  候補を人間が採用/却下           ├ 画像は pbs.twimg.com を直参照
                         │                                   ├ お気に入り/メモは端末内(IndexedDB)
npm run extract-items ───┘  Claude Vision で商品を抽出       └ オフライン対応(Service Worker)
```

**設計の要点**

- **公開されるのは静的ファイルだけ。** クロールもセッションも手元に閉じており、
  公開サーバには一切載らない。
- **画像は自サーバに再ホストしない。** `pbs.twimg.com/...?name=orig` を直接参照するので、
  クリエイターが投稿を削除すれば画像も消える（追随する）。ストレージ費もゼロ。
- **お気に入り・メモは端末内。** サーバに送信しない。JSON でエクスポート/インポートできる。
- **オフライン前提。** 会場は回線が飽和するため、事前保存が飾りではなく必須機能。

---

## セットアップ

```sh
npm install
npx playwright install chromium
```

Claude Vision による商品抽出を使う場合は `.env.local` を作る:

```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## 使い方

### 1. 公式出店者一覧を取得

```sh
npm run scrape-official
# → data/creators.{osaka,tokyo}.json, data/sponsors.*.json, data/x-targets.json
```

件数アサーション付き。公式サイトの DOM が変わったら「0件で静かに成功」ではなく
異常終了する。

### 2. X のログインセッションを用意（初回のみ）

```sh
npm run x-login
```

> **⚠ 必ずサブアカウント／捨てアカウントを使ってください。**
> X の利用規約は自動アクセスを禁止しており、アカウント凍結のリスクが実際にあります。
> ID・パスワード・2FA はブラウザに直接入力し、このツールは受け取りも保存もしません。
> 保存されるのはセッション情報のみ（`secrets/`、gitignore 済み）。

### 3. お品書きを収集

```sh
npm run crawl-x -- --limit 3     # まず3人で試す（推奨）
npm run crawl-x                  # 全161ハンドル（約15〜25分）
npm run crawl-x -- --headed      # ブラウザを表示して挙動を見る
npm run crawl-x -- --fresh       # 進捗を無視して最初から
```

ナビゲーション間 3〜6秒、レート制限を検知したら指数バックオフ。
中断しても `data/crawl-state.json` から再開する。

取り逃した投稿は `data/manual-posts.json` に URL を書けば拾える:

```json
[{ "url": "https://x.com/handle/status/1234567890" }]
```

### 4. 候補をレビュー

```sh
npm run review     # admin サーバ + next dev を同時起動
```

→ http://localhost:3000/admin/review

採用/却下は `data/curation.json` に永続化され、次回クロールを跨いで保持される。
判断していない投稿は score≧50 で暫定採用されるので、レビュー前でもサイトは空にならない。

**スコアリングの調整（実データから判明した除外条件）**

`scripts/lib/oshinagaki-score.ts`。単純なキーワード一致では以下の偽陽性が出た:

| 除外するもの | 理由 |
|---|---|
| 浜松（7/24-26）だけに言及する投稿 | 終了済みで対象外。同じクリエイターが多数出ているため大量に混ざり、**大阪ページに先月の品揃えを表示してしまう**。大阪・東京にも触れていれば除外しない |
| 頒布物に触れない投稿 | 「撤収しました！」等の報告がイベント名＋画像＋直近だけで65点に達していた。お品書き・頒布・価格のいずれにも触れない投稿は落とす |
| 別イベント（ボーマス等）の頒布告知 | イベント名が一致しないので自然に落ちる |

暫定採用の閾値を跨ぐ判断なので、変更したら `npm test` で境界を確認すること。

### 5. 商品情報を抽出（任意）

```sh
npm run extract-items -- --dry-run    # 対象と概算費用だけ表示
npm run extract-items -- --limit 1    # まず1枚で精度と実費を確認
npm run extract-items                 # 採用済みの未抽出画像すべて
```

`claude-opus-5` + 高解像度画像入力。実測 **約 $0.036/枚**（200枚で約$7）。
同じ画像には二度課金しない（`mediaKey` でキャッシュ）。

### 6. 会場マップのブース座標を生成

```sh
npm run detect-booths            # 大阪・東京の両方
npm run detect-booths -- --debug # 検出位置を重ねた確認用画像も出す
```

公式マップは「列ごとに色分けされた平坦な矩形の格子」なので、画像のピクセルを
解析して座標を機械的に取り出す（AI も手作業クリックも不要）。
検出したブース数が公式一覧と一致しない場合は書き出さずに異常終了する
— ずれた座標は誤った場所へ案内するため、無いより悪い。

実績: 大阪 7列91ブース / 東京 4列113ブース、いずれも公式一覧と完全一致。

周回順は蛇行順（列を順に、1列ごとに向きを反転）。即売会の通路構造では
最短経路探索より実際の歩き方に合う。入口の位置は会場ごとに違う
（大阪は右下、東京は右上）ので `VENUE_META[venue].route` に持たせている。

### 7. ビルドと公開

```sh
npm run build          # → out/（静的ファイル）
npm run preview        # ローカルで確認
```

git は不要。`out/` をそのままデプロイできる:

```sh
npx wrangler pages deploy out       # Cloudflare Pages
npx vercel deploy --prebuilt out    # Vercel
```

`/admin` は公開ビルドに一切含まれない（`next.config.ts` の `pageExtensions` で
`page.admin.tsx` をビルド対象から外している。実行時ゲートではクライアント
チャンクが出荷されてしまうため）。

---

## 掲載していいものだけを載せる仕組み

このサイトの正しさは「**証明できたものだけ載せる**」の一点で担保している。
判定は `scripts/lib/curation.ts` の `selectPostsForVenue` に集約されていて、
ここを通ったものだけが公開される。掲載の条件は次の4つすべて:

1. **その会場のものだと証明されている**（または人手で会場を指定した）
2. **マジカルミライの投稿である**（`isMagimiraPost`）
3. **頒布物の一覧そのものである**（`isOshinagakiPost`）
4. 掲載停止ハンドルでなく、人手で却下されていない

「たぶんこの会場だろう」は載せない。証明できなければ非公開のままにする。
未確定の投稿が増えてもサイトが間違うことは無く、載る件数が減るだけ。

### 「参考：浜松のお品書き」の別枠

浜松（7/24〜26）は終了済みだが、多くのサークルは3会場すべてに出る。
大阪・東京のお品書きをまだ投稿していないサークルには、
浜松で頒布されたお品書きを**別枠で**見せる（`selectReferencePostsForVenue`）。

これは「大阪のお品書き」ではない。売り切れた物も、大阪から増える物もある。
だから確定枠（`selectPostsForVenue`）には**入れない**。画面上でも枠を分け、

> 参考 — これは **浜松会場（7/24〜26・終了）** で頒布されたお品書きです。
> 大阪でも同じ内容が並ぶとは限りません（売り切れ・追加があります）。
> 大阪のお品書きが投稿されたら差し替わります。

と明記する。大阪のお品書きが確定した時点で参考枠は自動的に消える。

`verify-site` はこの枠より後ろを混入の検査対象から外すが、
**枠の明示（上の文言）が無いまま浜松のお品書きが並んでいたら混入として検出する。**

### 会場の証明（`scripts/lib/venue-attribution.ts`）

| 根拠 | 内容 |
|---|---|
| `text-booth` | 本文の会場名＋ブース番号が公式データと一致 |
| `sole-venue` | その作者がマジミラ2026で1会場にしか出ておらず、本文も他会場に言及していない |
| `image` | 画像を読んで得た会場・ブースが公式データと一致（`scripts/lib/image-verdict.ts`） |
| `manual` | `/admin/review` で人が会場を指定 |

**会場名だけでは証明にしない。** 「マジミラ浜松ありがとう！次は大阪でお待ちしてます」
のような投稿が大阪のお品書きとして公開されていたため。

**本文が画像を別会場に紐づけていたら外す**（`imageBoundVenues`）。
「東京 A-26 …まずは浜松のお品書き👇」の画像は浜松のものなので東京には出さない。

### お品書きかどうか

会場が正しくても、お品書きでなければ載せない。実際に混ざっていたもの:
制作の進捗報告（「C1/C2エラー試験中」）、制作こぼれ話（「トレカの角が丸くない」）、
他人の頒布物への言及（「ジャケットを担当しました」）、予告（「詳細は後日」）。

判定は「本文か代替テキストに『お品書き』の明示がある」か「画像を読んで確認した」の
どちらか。明示の無いお品書きは画像判別で拾う。

### 他イベントの排除

クリエイターは他の即売会にも出るので、ボーマス・音けっと・COMITIA・プロセカなどの
お品書きが大量に混ざる。どれも「大阪」「東京」やブース番号らしき文字列を含むので
会場判定だけでは弾けない。`isMagimiraPost` でイベント名から切る。
（「クリエイターズマーケット」はプロセカにも同名のものがあるので手掛かりにしない）

### 画像判別

お品書きかどうかは本来、画像の中身を見て決めるべきもの。本文の語は代用にすぎない。
そのため画像を読む層を用意してある。読み手は3種類あり、精度が違う。

| 読み手 | コマンド | 精度 | 陰性を信じてよいか |
|---|---|---|---|
| OCR (tesseract.js) | `npm run ocr-images` | 低い。実測で本物のお品書き15枚中5枚しか検出できない | **いいえ**。読めなかっただけの可能性が高い |
| Claude API | `npm run attribute-images` | 高い | はい |
| 人手 | `data/image-reads.json` に直接追記 | 高い | はい |

どの読み手の結果も `ImageRead.readBy` に記録され、`verifyImageRead()` で
公式の出展記録と照合される。**照合を通らないものは確定しない**ので、
誤読は誤掲載ではなく非掲載になる。

OCR の「読めなかった」を「お品書きではない」として扱うと、
本文の語で正しく載っている投稿を巻き添えで消してしまう。
そのため `apply-image-reads` は **OCR の陰性を書き込まない**（未判定のままにする）。

#### OCR で何が読めるか（実測）

| | 結果 |
|---|---|
| 会場名（大阪／浜松／東京） | 5枚中4枚（前処理を長辺2800pxまで拡大した場合） |
| ブース番号（F-11 など） | 4枚中2枚 |
| 日付（8/14 など） | ほぼ読めない |
| 価格（¥2,000 など） | お品書き15枚中5枚 |

装飾的な背景に白文字が乗ったポスターに弱い。`tessedit_pageseg_mode` を
SPARSE_TEXT / SINGLE_BLOCK / AUTO_OSD に変えても改善しなかった（既定の AUTO が最良）。

よって OCR は**足し算の手段**であって、本文の語の置き換えにはならない。
全件をきちんと読むなら Claude API を使うこと。

### Claude API による画像判別

`ANTHROPIC_API_KEY` があるなら:

```sh
npm run attribute-images -- --dry-run   # 対象件数とコストの見積
npm run attribute-images
```

鍵が無い場合は同じ照合ロジックを人手の読み取りに通せる:

```sh
npm run prepare-image-review   # 対象を data/image-review-queue.json に、画像を .image-review/ に
# 画像を見て data/image-reads.json に追記する
npm run apply-image-reads      # 公式データと照合して data/posts.json に反映
```

どちらの経路も `verifyImageRead` を通る。**画像に書いてあることをそのまま信じない**
— 公式の出展記録と突き合わせて、一致したものだけを確定にする。
実際、あるお品書きの「B-06（東京）」は大阪の誤記だったが、照合が自動で棄却した。

## デプロイ（Vercel）

`next.config.ts` が `output: 'export'` なので、Vercel は静的サイトとして配信する。
`NEXT_PUBLIC_ADMIN` を設定しないかぎり admin 画面はビルド対象から外れる
（HTML もクライアントJSも生成されない）ので、公開成果物に管理APIのURLは混ざらない。

### 初回

```sh
# GitHub にリポジトリを作ってから
git remote add origin https://github.com/<ユーザー名>/magimira-oshinagaki.git
git push -u origin main
```

Vercel でこのリポジトリを Import する。フレームワークは Next.js が自動検出され、
ビルドコマンド・出力ディレクトリの指定は不要。環境変数も不要
（`ANTHROPIC_API_KEY` はローカルのスクリプト専用で、サイトのビルドには使わない）。

`vercel.json` で `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` を渡している。
Playwright は検証スクリプト専用なので、Vercel 側でブラウザを落とす必要がない。

### 更新

```sh
npm run refresh        # 公式取得 → クロール → 再判定 → 検証 → ビルド → 検査
git add -A && git commit -m "データ更新"
git push
```

`refresh` は検証が1つでも落ちると中断するので、担保が破れた状態のデータは
コミットまで進まない。push すると Vercel が自動でビルドして公開する。

**`data/*.json` がサイトの実体**なので、これをコミットしないと内容は更新されない。

## 更新（会期が近づいたら毎日）

```sh
npm run refresh              # 公式取得 → クロール → 再判定 → 検証 → ビルド → サイト検査
npm run refresh -- --no-crawl  # クロールを飛ばして再判定だけ
```

検証で1つでも落ちたら中断する。担保が破れた状態のサイトは公開されない。

## 検証

```sh
npm test                   # 単体テスト（パーサ・スコアリング・キュレーション・会場帰属）
npm run typecheck
npm run verify-attribution # 公開される全件が当該会場・当該日のお品書きかを検証（データ層）
npm run verify-site        # ビルド済みHTMLを読んで他会場の混入を検査（表示層）
npm run verify-ui          # モバイル幅でのUI検証 + スクリーンショット
npm run verify-offline     # 実際に回線を切ってオフライン動作を検証
npm run verify-map         # ブース座標・ピン位置・周回順を検証
npm run verify-review      # レビュー画面の採用/却下の永続化を検証（admin サーバが必要）
```

`verify-attribution` と `verify-site` は別の材料を見ている。
前者は `data/*.json`、後者は実際に配信される HTML。
画像紐づけの混入は前者では見つからず、後者が拾った。両方を通すこと。

`verify-*` は `npm run preview` で配信中の `out/` に対して実行する。
スクリーンショットは `screenshots/` に出る。

X のクロールや API キーが無い環境で UI を確認したい場合:

```sh
npm run fixture              # 検証用の投稿データを生成
npm run fixture -- --clean   # 消す
```

---

## ディレクトリ

```
data/                 生成データ（実質DB。コミット対象）
secrets/              X のセッション（gitignore。絶対に共有しない）
scripts/
  lib/                クローラーとUIで共有するロジック
    types.ts          全データ型・会場メタ情報
    official-parser.ts 公式サイトのパーサ
    x-graphql.ts      X の GraphQL レスポンス解析
    x-capture.ts      Playwright でのレスポンス傍受
    oshinagaki-score.ts お品書きらしさのスコアリング
    curation.ts       掲載判定（公開サイトと抽出で共有）
    booth-detect.ts   マップ画像からのブース矩形検出
    route.ts          蛇行順の周回ルート
  scrape-official.ts  公式一覧の取得
  x-login.ts          手動ログイン
  crawl-x.ts          X クロール
  extract-items.ts    Claude Vision 抽出
  detect-booth-coords.ts ブース座標の生成
  admin-server.ts     ローカル専用の書き込みサイドカー
  make-fixture.ts     UI検証用のデータ生成
  verify-*.ts         各種の自動検証
src/
  app/                Next.js App Router
    admin/review/page.admin.tsx   公開ビルドから除外される
  components/
  lib/
public/
  sw.js               Service Worker（オフライン対応）
```

---

## 注意

非公式のファン制作ツールです。

- 出店者情報は[マジカルミライ公式サイト](https://magicalmirai.com/2026/)より取得
- お品書き画像は各クリエイターの X 投稿を参照（当サイトでは保持しない）
- 掲載停止のご希望は `data/curation.json` の `excludedHandles` に追加すれば
  次回ビルドから除外される
