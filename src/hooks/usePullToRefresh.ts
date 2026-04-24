/**
 * usePullToRefresh — mobile pull-to-refresh gesture hook.
 *
 * Extracted from ExecutiveMobilePage during the consolidation into ApexPage.
 * Binds touch handlers to a scroll container ref and invokes `onRefresh()`
 * when the user pulls down past a threshold from the top of the container.
 *
 * Usage:
 *   const { containerProps, pullDistance, refreshing } = usePullToRefresh(fetchData);
 *   return <div ref={containerProps.ref} onTouchStart={containerProps.onTouchStart} ... />
 *
 * The hook is intentionally minimal and has no dependency on UI libraries —
 * the caller renders whatever indicator they like using `pullDistance` and
 * `refreshing`.
 */
import { useCallback, useRef, useState } from "react";

export interface PullToRefreshState {
  /** Props to spread onto the scrollable container. */
  containerProps: {
    ref: React.RefObject<HTMLDivElement>;
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
  /** Current pull distance in px (0 when not pulling). */
  pullDistance: number;
  /** True while the refresh promise is in flight. */
  refreshing: boolean;
  /** Threshold in px at which release triggers refresh. */
  threshold: number;
}

export function usePullToRefresh(
  onRefresh: () => void | Promise<void>,
  options: { threshold?: number; maxPull?: number } = {}
): PullToRefreshState {
  const threshold = options.threshold ?? 50;
  const maxPull = options.maxPull ?? 80;

  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (containerRef.current && containerRef.current.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const diff = e.touches[0].clientY - startY.current;
    if (diff > 0 && containerRef.current && containerRef.current.scrollTop === 0) {
      setPullDistance(Math.min(diff * 0.5, maxPull));
    }
  }, [maxPull]);

  const onTouchEnd = useCallback(() => {
    if (pullDistance > threshold) {
      setRefreshing(true);
      Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
    }
    setPullDistance(0);
  }, [pullDistance, threshold, onRefresh]);

  return {
    containerProps: {
      ref: containerRef,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
    pullDistance,
    refreshing,
    threshold,
  };
}
