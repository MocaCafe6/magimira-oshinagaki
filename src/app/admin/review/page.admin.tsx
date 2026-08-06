import { ReviewView, type ReviewCandidate } from '@/components/ReviewView';
import { loadAllCreators, loadCuration, loadPosts, selectReviewCandidates } from '@/lib/data';

/**
 * お品書き候補のレビュー画面（ローカル専用）。
 *
 * ファイル名が `page.admin.tsx` なのは意図的。
 * next.config.ts の pageExtensions により、NEXT_PUBLIC_ADMIN=1 のとき
 * だけページとして認識される。公開ビルドでは HTML もクライアント JS も
 * 生成されないので、管理APIのURLが公開成果物に混ざることがない。
 *
 *   npm run review   … admin-server と next dev を同時に起動
 */
export default async function ReviewPage() {
  const [posts, creators, curation] = await Promise.all([
    loadPosts(),
    loadAllCreators(),
    loadCuration(),
  ]);

  // ハンドル → サークル名／ブース（判断の材料として出す）
  const byHandle = new Map<string, { circleName: string; boothIds: string[]; venues: string[] }>();
  for (const c of creators) {
    for (const h of c.xHandles) {
      const k = h.toLowerCase();
      const cur = byHandle.get(k) ?? { circleName: c.circleName, boothIds: [], venues: [] };
      if (c.boothId && !cur.boothIds.includes(c.boothId)) cur.boothIds.push(c.boothId);
      if (!cur.venues.includes(c.venue)) cur.venues.push(c.venue);
      byHandle.set(k, cur);
    }
  }

  const candidates: ReviewCandidate[] = selectReviewCandidates(posts, curation)
    .map((p) => {
      const owner = byHandle.get(p.handle.toLowerCase());
      return {
        post: p,
        circleName: owner?.circleName ?? '(公式一覧に該当なし)',
        boothIds: owner?.boothIds ?? [],
        venues: owner?.venues ?? [],
        verdict: curation.verdicts[p.id] ?? null,
        manualVenues: curation.manualVenues?.[p.id] ?? [],
      };
    })
    .sort((a, b) => {
      // 会場が未確定のものを先に（公開されないので、ここを潰すのが最優先）
      const au = a.post.attribution?.provenVenues.length ? 1 : 0;
      const bu = b.post.attribution?.provenVenues.length ? 1 : 0;
      if (au !== bu) return au - bu;
      const av = a.verdict === null ? 0 : 1;
      const bv = b.verdict === null ? 0 : 1;
      if (av !== bv) return av - bv;
      return b.post.score - a.post.score;
    });

  return <ReviewView candidates={candidates} excludedHandles={curation.excludedHandles} />;
}
