import { memo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { GalleryEntry } from '../../app/store';
import { useAppActions, useAppState } from '../../app/ApplicationProvider';
import { useThumbnail } from './useThumbnail';
import { aspectRatios } from './mediaMetrics';

export const GalleryCard = memo(function GalleryCard({ entry }: { entry: GalleryEntry }) {
  const actions = useAppActions();
  const { item } = entry;
  const card = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const { source, ready, failed, attempt, markReady, retry } = useThumbnail(item, card, video);
  const [pending, setPending] = useState(false);
  const hiddenMode = useAppState((state) => state.listMode === 'hidden');
  const directory = item.type === 'directory';

  async function toggle(kind: 'favorite' | 'hidden') {
    if (pending) return;
    setPending(true);
    try {
      await actions.toggleEntry(entry, kind);
    } catch (error) {
      console.error(error);
    } finally {
      setPending(false);
    }
  }
  const ratio = aspectRatios.get(item.handle);
  return (
    <div
      ref={card}
      className={`group item-card ${directory ? 'directory-card' : 'media-card'}`}
      data-dir-name={directory ? item.name : undefined}
      data-thumb-ready={ready ? 'true' : undefined}
      onClick={() => {
        if (!directory) void actions.openEntry(entry);
      }}
    >
      <div
        className="thumbnail-container cursor-pointer"
        style={ratio ? ({ '--thumbnail-aspect': ratio } as CSSProperties) : undefined}
        onClick={
          directory
            ? () => {
                void actions.openEntry(entry);
              }
            : undefined
        }
      >
        {source && item.type !== 'video' && (
          <img
            key={`${source.url}:${attempt}`}
            src={source.url}
            alt={directory ? `Thumbnail for ${item.name}` : item.name}
            loading="eager"
            decoding="async"
            onLoad={(event) =>
              markReady(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
            }
            onError={retry}
          />
        )}
        {item.type === 'video' && (
          <>
            <video
              ref={video}
              src={source ? `${source.url}#t=0.5` : undefined}
              muted
              preload="metadata"
              onLoadedMetadata={(event) =>
                markReady(event.currentTarget.videoWidth, event.currentTarget.videoHeight)
              }
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <svg
                className="w-16 h-16 text-white opacity-70"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          </>
        )}
        {failed &&
          (directory ? (
            <svg className="h-16 w-16 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
          ) : (
            <span>画像を読み込めませんでした</span>
          ))}
        {directory && (
          <button
            className="read-button"
            onClick={(event) => {
              event.stopPropagation();
              void actions.readDirectory(item.handle);
            }}
          >
            開く
          </button>
        )}
        {entry.parent && (
          <>
            {entry.parentPath && (
              <button
                type="button"
                disabled={pending}
                className={`hidden-toggle-btn${hiddenMode ? ' restore' : ''}`}
                aria-pressed={!!item.isHidden}
                aria-label={hiddenMode ? '非表示を解除' : '非表示'}
                onClick={(event) => {
                  event.stopPropagation();
                  void toggle('hidden');
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d={
                      hiddenMode
                        ? 'M12 5V2L7 7l5 5V9c3.31 0 6 2.69 6 6a6 6 0 01-6 6 6 6 0 01-5.65-4H4.26A8 8 0 0012 22a8 8 0 000-16z'
                        : 'M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.29-6.3z'
                    }
                  />
                </svg>
              </button>
            )}
            <button
              type="button"
              className={`favorite-btn${item.isFavorite ? ' active' : ''}`}
              disabled={pending}
              aria-label="お気に入り"
              aria-pressed={!!item.isFavorite}
              onClick={(event) => {
                event.stopPropagation();
                void toggle('favorite');
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 6 4 4 6.5 4c1.74 0 3.41 1.01 4.22 2.62h2.56C14.09 5.01 15.76 4 17.5 4 20 4 22 6 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </button>
          </>
        )}
      </div>
      {directory && (
        <h3
          className="dir-title"
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest('.dir-badge')) void actions.openEntry(entry);
          }}
        >
          <span className="break-all">{item.name}</span>
          <span className="dir-badge">フォルダ</span>
        </h3>
      )}
    </div>
  );
});
