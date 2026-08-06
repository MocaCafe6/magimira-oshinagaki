'use client';

/**
 * 実際に通信できるかを確かめる。
 *
 * navigator.onLine には二つの穴があり、会場ではどちらも踏む:
 *  1. ネットワークインターフェースの有無しか見ていない。混雑した会場で
 *     Wi-Fi/LTE を掴んでいるが実質通らない状態を online と報告する。
 *  2. Service Worker のキャッシュから復帰した直後は true に戻ることがある。
 *
 * そこで小さな同一オリジンのリソースを no-store で取りに行って判定する。
 * 常時ポーリングはしない（電池を食う）。マウント時・復帰時・
 * online/offline イベント時にだけ確認する。
 */

import { useCallback, useEffect, useState } from 'react';

export type Reachability = 'unknown' | 'online' | 'offline';

const PROBE_PATH = '/manifest.webmanifest';
const TIMEOUT_MS = 4_000;

async function probe(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PROBE_PATH}?probe=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function useReachability(): { state: Reachability; recheck: () => void } {
  const [state, setState] = useState<Reachability>('unknown');

  const check = useCallback(() => {
    // インターフェースが無いなら確実にオフライン。無駄な probe を省く。
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setState('offline');
      return;
    }
    void probe().then((ok) => setState(ok ? 'online' : 'offline'));
  }, []);

  useEffect(() => {
    check();

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  return { state, recheck: check };
}
