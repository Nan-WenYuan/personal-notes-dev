interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function scrollProgress(metrics: ScrollMetrics): number {
  const range = metrics.scrollHeight - metrics.clientHeight;
  // All content is visible when no scrolling is possible.
  return range > 0 ? Math.min(1, Math.max(0, metrics.scrollTop / range)) : 1;
}

export function scrollOffset(
  fraction: number,
  metrics: Pick<ScrollMetrics, "scrollHeight" | "clientHeight">,
): number {
  return (
    Math.min(1, Math.max(0, fraction)) * Math.max(0, metrics.scrollHeight - metrics.clientHeight)
  );
}
