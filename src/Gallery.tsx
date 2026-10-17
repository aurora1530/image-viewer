import { memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useStore } from 'zustand';
import { appStore, sizeOptions } from './appStore';
import type { GalleryEntry } from './appStore';
import { actions } from './application';
import { getDirectoryPreviewUrl } from './directoryCache';
import { getMediaSource } from './nativeFs';
import { thumbnailCache } from './thumbnailCache';
import { createVirtualGallery } from './virtualGallery';

const aspectRatios = new WeakMap<FileSystemHandle, number>();
type Source = { url: string; objectUrl: boolean };
const visibilityCallbacks = new Map<Element, () => void>();
let visibilityObserver: IntersectionObserver | null = null;
function observeThumbnail(element: HTMLElement, load: () => void) {
  if (typeof IntersectionObserver === 'undefined') { load(); return () => { }; }
  visibilityObserver ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const callback = visibilityCallbacks.get(entry.target);
      visibilityCallbacks.delete(entry.target);
      visibilityObserver?.unobserve(entry.target);
      callback?.();
    }
  }, { rootMargin: '600px' });
  visibilityCallbacks.set(element, load);
  visibilityObserver.observe(element);
  return () => {
    visibilityCallbacks.delete(element);
    visibilityObserver?.unobserve(element);
    if (!visibilityCallbacks.size) { visibilityObserver?.disconnect(); visibilityObserver = null; }
  };
}

export const GalleryCard = memo(function GalleryCard({ entry }: { entry: GalleryEntry }) {
  const { item } = entry;
  const card = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const hiddenMode = useStore(appStore, state => state.listMode === 'hidden');
  const directory = item.type === 'directory';

  useEffect(() => {
    let active = true;
    let owned: Source | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setSource(null); setReady(false); setFailed(false);
    const element = card.current!;
    const shouldContinue = () => active && element.isConnected;
    const getPriority = () => {
      const rect = element.getBoundingClientRect();
      return rect.bottom <= 0 ? -rect.bottom + 1 : rect.top >= window.innerHeight ? rect.top - window.innerHeight + 1 : 0;
    };
    const stopObserving = observeThumbnail(element, () => {
      const load = async () => {
        try {
          let result: Source | null;
          if (item.type === 'image') result = await thumbnailCache.get(item.handle, shouldContinue, getPriority);
          else if (item.type === 'video') result = await getMediaSource(item.handle);
          else {
            const url = await getDirectoryPreviewUrl(item.handle, { shouldContinue, getPriority });
            result = url ? { url, objectUrl: false } : null;
          }
          if (!shouldContinue()) {
            if (result?.objectUrl) URL.revokeObjectURL(result.url);
            return;
          }
          owned = result;
          setSource(result);
          if (!result && item.type === 'directory') setFailed(true);
        } catch (error) {
          if (!active) return;
          console.error(`サムネイル生成失敗: ${item.name}`, error);
          setFailed(true);
        }
      };
      // Failed decodes get a short delay before the next cache request.
      if (attempt) retry = setTimeout(() => { void load(); }, 300 * attempt);
      else void load();
    });
    const media = video.current;
    return () => {
      active = false; stopObserving(); clearTimeout(retry);
      if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
      if (owned?.objectUrl) URL.revokeObjectURL(owned.url);
    };
  }, [item.handle, item.type, item.name, attempt]);

  async function toggle(kind: 'favorite' | 'hidden') {
    if (pending) return;
    setPending(true);
    try { await actions.toggleEntry(entry, kind); }
    catch (error) { console.error(error); }
    finally { setPending(false); }
  }
  const markReady = (width: number, height: number) => {
    if (height) aspectRatios.set(item.handle, width / height);
    setReady(true);
  };
  const ratio = aspectRatios.get(item.handle);
  return <div ref={card} className={`group item-card ${directory ? 'directory-card' : 'media-card'}`}
    data-dir-name={directory ? item.name : undefined} data-thumb-ready={ready ? 'true' : undefined}
    onClick={() => { if (!directory) void actions.openEntry(entry); }}>
    <div className="thumbnail-container cursor-pointer" style={ratio ? { '--thumbnail-aspect': ratio } as CSSProperties : undefined}
      onClick={directory ? () => { void actions.openEntry(entry); } : undefined}>
      {source && item.type !== 'video' && <img key={`${source.url}:${attempt}`} src={source.url}
        alt={directory ? `Thumbnail for ${item.name}` : item.name} loading="eager" decoding="async"
        onLoad={event => markReady(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
        onError={() => {
          if (!card.current?.isConnected || item.type !== 'image') return;
          thumbnailCache.invalidate(item.handle);
          setSource(null);
          if (attempt < 2) setAttempt(attempt + 1);
          else setFailed(true);
        }} />}
      {item.type === 'video' && <>
        <video ref={video} src={source ? `${source.url}#t=0.5` : undefined} muted preload="metadata"
          onLoadedMetadata={event => markReady(event.currentTarget.videoWidth, event.currentTarget.videoHeight)} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"><svg className="w-16 h-16 text-white opacity-70" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg></div>
      </>}
      {failed && (directory ? <svg className="h-16 w-16 text-gray-500" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg> : <span>画像を読み込めませんでした</span>)}
      {directory && <button className="read-button" onClick={event => { event.stopPropagation(); void actions.readDirectory(item.handle); }}>開く</button>}
      {entry.parent && <>
        {entry.parentPath && <button type="button" disabled={pending}
          className={`hidden-toggle-btn${hiddenMode ? ' restore' : ''}`} aria-pressed={!!item.isHidden}
          aria-label={hiddenMode ? '非表示を解除' : '非表示'} onClick={event => { event.stopPropagation(); void toggle('hidden'); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={hiddenMode ? 'M12 5V2L7 7l5 5V9c3.31 0 6 2.69 6 6a6 6 0 01-6 6 6 6 0 01-5.65-4H4.26A8 8 0 0012 22a8 8 0 000-16z' : 'M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.29-6.3z'} /></svg>
        </button>}
        <button type="button" className={`favorite-btn${item.isFavorite ? ' active' : ''}`} disabled={pending}
          aria-label="お気に入り" aria-pressed={!!item.isFavorite} onClick={event => { event.stopPropagation(); void toggle('favorite'); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 6 4 4 6.5 4c1.74 0 3.41 1.01 4.22 2.62h2.56C14.09 5.01 15.76 4 17.5 4 20 4 22 6 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
        </button>
      </>}
    </div>
    {directory && <h3 className="dir-title" onClick={event => { if (!(event.target as HTMLElement).closest('.dir-badge')) void actions.openEntry(entry); }}>
      <span className="break-all">{item.name}</span><span className="dir-badge">フォルダ</span>
    </h3>}
  </div>;
});

export type GalleryNavigation = { scrollToDirectory(name: string): HTMLElement | null };
export function Gallery({ ref }: { ref?: Ref<GalleryNavigation> }) {
  const entries = useStore(appStore, state => state.entries);
  const sizeIndex = useStore(appStore, state => state.thumbnailSizeIndex);
  const home = useStore(appStore, state => state.screen === 'home');
  const size = sizeOptions[sizeIndex];
  const container = useRef<HTMLDivElement>(null);
  const virtual = useRef<ReturnType<typeof createVirtualGallery> | null>(null);
  const [slots, setSlots] = useState<Array<{ index: number; host: HTMLElement }>>([]);
  const isVirtual = entries.length > 200;
  // Favorite metadata can change without rebuilding rows or losing the scroll anchor.
  const order = useMemo(() => entries.map(entry => entry.key).join('\0'), [entries]);

  useLayoutEffect(() => {
    if (!isVirtual) return;
    let active = true;
    let initializing = true;
    const mounted = new Map<HTMLElement, number>();
    const publish = () => {
      if (!active) return;
      const next = Array.from(mounted, ([host, index]) => ({ host, index }));
      // During setup React flushes layout-effect updates before paint. Later
      // scroll frames need a synchronous commit after all slot changes.
      if (initializing) setSlots(next);
      else flushSync(() => setSlots(next));
    };
    // The layout engine owns only empty slots. React owns all card contents.
    const engine = createVirtualGallery(container.current!, entries.length, (index, row) => {
      const host = document.createElement('div');
      host.className = 'gallery-slot';
      row.append(host); mounted.set(host, index);
      return host;
    }, host => { mounted.delete(host); }, () => active, (index, width) => {
      const item = entries[index].item;
      const original = container.current!.classList.contains('original-aspect') && item.type !== 'directory';
      return Math.max(1, width - 2) / (original ? aspectRatios.get(item.handle) || 4 / 3 : 4 / 3) + 2 + (item.type === 'directory' ? 52 : 0);
    }, publish);
    initializing = false;
    virtual.current = engine;
    return () => { active = false; engine.dispose(); virtual.current = null; };
  }, [order, isVirtual]);

  useImperativeHandle(ref, () => ({
    scrollToDirectory(name) {
      const index = entries.findIndex(entry => entry.item.type === 'directory' && entry.item.name === name);
      if (index < 0) return null;
      if (virtual.current) {
        const host = virtual.current.scrollToItem(index);
        return host?.querySelector<HTMLElement>('.directory-card') ?? null;
      }
      return Array.from(container.current?.querySelectorAll<HTMLElement>('.directory-card') ?? []).find(card => card.dataset.dirName === name) ?? null;
    }
  }), [entries]);

  return <div id="item-list" ref={container} className={`grid contact-sheet${size.originalAspect ? ' original-aspect' : ''}${home ? ' hidden' : ''}`}
    style={{ '--thumbnail-min-width': `${size.minWidth}px`, '--thumbnail-gap': `${size.gap}px` } as CSSProperties}>
    {isVirtual ? slots.filter(slot => slot.host.isConnected && entries[slot.index]).map(slot => createPortal(
      <GalleryCard entry={entries[slot.index]} />, slot.host, entries[slot.index].key
    )) : entries.map(entry => <GalleryCard key={entry.key} entry={entry} />)}
  </div>;
}
