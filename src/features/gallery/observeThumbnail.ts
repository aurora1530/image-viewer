const visibilityCallbacks = new Map<Element, () => void>();
let visibilityObserver: IntersectionObserver | null = null;
export function observeThumbnail(element: HTMLElement, load: () => void) {
  if (typeof IntersectionObserver === 'undefined') {
    load();
    return () => {};
  }
  visibilityObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = visibilityCallbacks.get(entry.target);
        visibilityCallbacks.delete(entry.target);
        visibilityObserver?.unobserve(entry.target);
        callback?.();
      }
    },
    { rootMargin: '600px' },
  );
  visibilityCallbacks.set(element, load);
  visibilityObserver.observe(element);
  return () => {
    visibilityCallbacks.delete(element);
    visibilityObserver?.unobserve(element);
    if (!visibilityCallbacks.size) {
      visibilityObserver?.disconnect();
      visibilityObserver = null;
    }
  };
}
