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
  const thumbnailStyle: (CSSProperties & { '--thumbnail-aspect': number }) | undefined = ratio
    ? { '--thumbnail-aspect': ratio }
    : undefined;
  return (
    <div
      ref={card}
      title={item.name}
      className={`group item-card ${directory ? 'directory-card' : 'media-card'}`}
      data-dir-name={directory ? item.name : undefined}
      data-thumb-ready={ready ? 'true' : undefined}
      onClick={() => {
        if (!directory) void actions.openEntry(entry);
      }}
    >
      <div
        className="thumbnail-container cursor-pointer"
        style={thumbnailStyle}
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
              <span className="video-play-badge" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path d="M7.25 5.75a.75.75 0 0 1 1.14-.64l6.5 4.25a.75.75 0 0 1 0 1.28l-6.5 4.25a.75.75 0 0 1-1.14-.64v-8.5Z" />
                </svg>
              </span>
            </div>
          </>
        )}
        {item.type === 'pdf' && <span className="pdf-badge">PDF</span>}
        {failed &&
          (directory ? (
            <svg
              className="h-12 w-12 text-gray-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.3a1.5 1.5 0 0 1 1.14.52l1.22 1.43a1.5 1.5 0 0 0 1.14.52H19.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-12Z" />
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
                  {hiddenMode ? (
                    <>
                      <path d="M4.5 9.5h9a5 5 0 0 1 0 10H9" />
                      <path d="M8 6 4.5 9.5 8 13" />
                    </>
                  ) : (
                    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
                  )}
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
                <path d="M12 20.25s-7.5-4.35-7.5-10.1a4.35 4.35 0 0 1 7.5-3.02 4.35 4.35 0 0 1 7.5 3.02c0 5.75-7.5 10.1-7.5 10.1Z" />
              </svg>
            </button>
          </>
        )}
      </div>
      {directory && (
        <h3
          className="dir-title"
          onClick={(event) => {
            if (event.target instanceof Element && !event.target.closest('.dir-badge'))
              void actions.openEntry(entry);
          }}
        >
          <span className="break-all">{item.name}</span>
          <span className="dir-badge">フォルダ</span>
        </h3>
      )}
    </div>
  );
});
