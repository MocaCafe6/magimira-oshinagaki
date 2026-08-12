import { ItemsView, type ItemRow } from '@/components/ItemsView';
import { OshinagakiGallery, type GalleryItem } from '@/components/OshinagakiGallery';
import {
  buildVenueIndex,
  loadAllCreators,
  loadCuration,
  loadExtractions,
  loadImageReadNotes,
  loadPosts,
  selectPostsForVenue,
} from '@/lib/data';
import { detectGoodsCategories } from '@shared/goods-category';
import type { Creator, Post, Venue } from '@shared/types';
import { VENUES } from '@shared/types';

export default async function ItemsPage() {
  const [creators, posts, curation, extractions] = await Promise.all([
    loadAllCreators(),
    loadPosts(),
    loadCuration(),
    loadExtractions(),
  ]);

  // 会場ごとに「その会場で公開される投稿」を求める。
  // 東京専用のお品書きの商品が大阪の行として出ることを防ぐ。
  const postsByVenue = new Map<Venue, Map<string, Post>>();
  for (const v of VENUES) {
    postsByVenue.set(v, new Map(selectPostsForVenue(posts, curation, v).map((p) => [p.id, p])));
  }

  // ハンドル → サークル（複数会場に出るクリエイターは会場ごとに行を作る）
  const creatorsByHandle = new Map<string, Creator[]>();
  for (const c of creators) {
    for (const h of c.xHandles) {
      const k = h.toLowerCase();
      const arr = creatorsByHandle.get(k) ?? [];
      arr.push(c);
      creatorsByHandle.set(k, arr);
    }
  }

  const rows: ItemRow[] = [];
  for (const e of extractions) {
    // どの会場のものかは、サークル側の会場で判定する
    const anyPost = posts.find((p) => p.id === e.postId);
    if (!anyPost) continue;
    const owners = creatorsByHandle.get(anyPost.handle.toLowerCase()) ?? [];
    for (const owner of owners) {
      // そのサークルの会場でこの投稿が公開されないなら、商品も出さない
      const post = postsByVenue.get(owner.venue)?.get(e.postId);
      if (!post) continue;
      e.items.forEach((it, idx) => {
        rows.push({
          key: `${e.postId}:${e.mediaIndex}:${idx}:${owner.id}`,
          creatorId: owner.id,
          circleName: owner.circleName,
          boothId: owner.boothId,
          venue: owner.venue,
          days: owner.days,
          postId: e.postId,
          postUrl: post.url,
          mediaIndex: e.mediaIndex,
          itemIndex: idx,
          thumbUrl: post.media[e.mediaIndex]?.thumbUrl ?? null,
          name: it.name,
          price: it.price,
          priceNote: it.priceNote,
          category: it.category,
          confidence: it.confidence,
        });
      });
    }
  }

  const categories = [...new Set(rows.map((r) => r.category))].sort((a, b) =>
    a.localeCompare(b, 'ja'),
  );

  // 商品名・価格の抽出がまだ無いときは、お品書きの画像そのものを並べる。
  // 「まだ抽出されていません」とだけ出しても閲覧者の役に立たない。
  if (rows.length === 0) {
    // 「アクキーだけ見たい」で絞れるように、頒布物の種類を推定して付ける。
    //
    // 手掛かりは投稿の本文・画像の代替テキスト・目視の書き起こし。
    // 商品名の構造化抽出（items.json）が無くても、語の有無だけで
    // 「CD」「アクスタ」といった絞り込みはできる。
    const notesByPost = await loadImageReadNotes();
    const postById = new Map(posts.map((p) => [p.id, p]));

    const gallery: GalleryItem[] = [];
    for (const v of VENUES) {
      const index = await buildVenueIndex(v);
      for (const c of index.creators) {
        const isRef = c.images.length === 0;
        const imgs = c.images.length > 0 ? c.images : c.referenceImages;
        imgs.forEach((m, i) => {
          const post = m.postId ? postById.get(m.postId) : undefined;
          gallery.push({
            key: `${c.id}:${i}`,
            creatorId: c.id,
            circleName: c.circleName,
            boothId: c.boothId,
            venue: c.venue,
            largeUrl: m.largeUrl,
            origUrl: m.origUrl,
            altText: m.altText,
            width: m.width,
            height: m.height,
            isReference: isRef,
            categories: detectGoodsCategories(
              post?.text,
              m.altText,
              m.postId ? notesByPost.get(m.postId) : null,
            ),
          });
        });
      }
    }
    // 確定分を先に、そのあと参考。会場・ブース番号順
    gallery.sort(
      (a, b) =>
        Number(a.isReference) - Number(b.isReference) ||
        a.venue.localeCompare(b.venue) ||
        (a.boothId ?? '').localeCompare(b.boothId ?? '', 'ja', { numeric: true }),
    );
    return <OshinagakiGallery items={gallery} />;
  }

  return <ItemsView rows={rows} categories={categories} />;
}
