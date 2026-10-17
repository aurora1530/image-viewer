import type { AppStore } from './store';
import { normalizeThumbnailSize } from './store';
import type { FavoriteMode } from './store';
import type { FilterType } from '../shared/model';
import type { ConfigNode } from '../services/storage';

type PreferenceDependencies = {
  store: AppStore;
  persist: (name: string, value: string) => void;
  saveSettings: () => void;
  refreshList: (debounceMs?: number) => void;
  refreshPages: () => Promise<void>;
  navigatePages: (direction: number) => void;
};
const isFilterType = (value: string): value is FilterType =>
  ['all', 'directory', 'image', 'gif', 'video', 'pdf'].includes(value);

export function createPreferences(deps: PreferenceDependencies) {
  const get = deps.store.getState;
  const set = deps.store.setState;
  const scheduleSaveCurrentDirectoryConfig = deps.saveSettings;
  const scheduleProcessForCurrentDir = deps.refreshList;
  function getCurrentSettingsSnapshot() {
    const s = get();
    return {
      thumbnailSizeIndex: s.thumbnailSizeIndex,
      sortOrder: s.sortOrder,
      filterType: s.filterType,
      favoriteFirst: s.favoriteMode === 'first',
      favoriteOnly: s.favoriteMode === 'only',
    };
  }
  function applySettingsFromConfig(config: ConfigNode | null) {
    const settings = config?.settings;
    if (!settings) return;
    const next = { ...getCurrentSettingsSnapshot() };
    if (
      typeof settings.thumbnailSizeIndex === 'number' ||
      typeof settings.thumbnailSizeIndex === 'string'
    ) {
      next.thumbnailSizeIndex = normalizeThumbnailSize(Number(settings.thumbnailSizeIndex));
    }
    if (settings.sortOrder === 'asc' || settings.sortOrder === 'desc')
      next.sortOrder = settings.sortOrder;
    if (typeof settings.filterType === 'string' && isFilterType(settings.filterType))
      next.filterType = settings.filterType;
    if (typeof settings.favoriteFirst === 'boolean') next.favoriteFirst = settings.favoriteFirst;
    if (typeof settings.favoriteOnly === 'boolean') next.favoriteOnly = settings.favoriteOnly;
    set({
      thumbnailSizeIndex: next.thumbnailSizeIndex,
      sortOrder: next.sortOrder,
      filterType: next.filterType,
      favoriteMode: next.favoriteOnly ? 'only' : next.favoriteFirst ? 'first' : 'off',
    });
  }

  return {
    getSettingsSnapshot: getCurrentSettingsSnapshot,
    applySettings: applySettingsFromConfig,
    actions: {
      setThumbnailSize(value: number) {
        const thumbnailSizeIndex = normalizeThumbnailSize(value);
        set({ thumbnailSizeIndex });
        deps.persist('thumbnailSizeIndex', String(thumbnailSizeIndex));
        scheduleSaveCurrentDirectoryConfig();
      },
      setFilter(value: string) {
        set({ filterType: isFilterType(value) ? value : 'all' });
        scheduleSaveCurrentDirectoryConfig();
        scheduleProcessForCurrentDir(0);
      },
      setSearch(searchQuery: string) {
        set({ searchQuery });
        scheduleProcessForCurrentDir(180);
      },
      toggleSort() {
        set({ sortOrder: get().sortOrder === 'asc' ? 'desc' : 'asc' });
        scheduleSaveCurrentDirectoryConfig();
        scheduleProcessForCurrentDir(0);
      },
      setFavoriteMode(mode: FavoriteMode) {
        set({ favoriteMode: mode });
        scheduleSaveCurrentDirectoryConfig();
        scheduleProcessForCurrentDir(0);
      },
      toggleUi() {
        const isUiHidden = !get().isUiHidden;
        set({ isUiHidden, isUiDockRevealed: false });
        deps.persist('isUiHidden', isUiHidden ? '1' : '0');
      },
      revealDock(isUiDockRevealed: boolean) {
        if (get().isUiHidden && get().isUiDockRevealed !== isUiDockRevealed)
          set({ isUiDockRevealed });
      },
      toggleSinglePage() {
        const isSinglePageView = !get().isSinglePageView;
        set({ isSinglePageView });
        deps.persist('isSinglePageView', isSinglePageView ? '1' : '0');
        void deps.refreshPages();
      },
      adjustSpread() {
        set({ pageOffset: 1 - get().pageOffset });
        void deps.refreshPages();
      },
      turnPage(direction: number) {
        deps.navigatePages(direction * (get().isSinglePageView ? 1 : 2));
      },
    },
  };
}
