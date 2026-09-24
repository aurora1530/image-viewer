import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolbar } from '../../src/toolbar';
import { DOM, state } from '../../src/state';
import { populateSizeSelect, updateThumbnailSize, updateUiVisibilityUI, updateViewModeUI } from '../../src/ui';

beforeEach(() => {
  state.thumbnailSizeIndex = 1;
  state.isUiHidden = false;
  state.isUiDockRevealed = false;
  state.isSinglePageView = false;
});

describe('display preferences', () => {
  it('clamps an invalid thumbnail size and applies the selected layout', () => {
    populateSizeSelect();
    state.thumbnailSizeIndex = 999;
    updateThumbnailSize();
    expect(DOM.sizeSelect.value).toBe('5');
    expect(DOM.itemList.style.getPropertyValue('--thumbnail-min-width')).toBe('520px');
    expect(DOM.itemList.classList.contains('original-aspect')).toBe(true);
    state.thumbnailSizeIndex = Number.NaN;
    updateThumbnailSize();
    expect(DOM.sizeSelect.value).toBe('1');
    expect(DOM.itemList.classList.contains('original-aspect')).toBe(false);
  });

  it('reflects hidden UI and single-page view for users', () => {
    state.isUiHidden = true;
    state.isUiDockRevealed = true;
    updateUiVisibilityUI();
    expect(document.body.classList.contains('ui-hidden-mode')).toBe(true);
    expect(document.body.classList.contains('ui-dock-revealed')).toBe(true);
    expect(DOM.uiVisibilityBtn.getAttribute('aria-pressed')).toBe('true');
    state.isSinglePageView = true;
    updateViewModeUI();
    expect(DOM.toggleViewBtn.textContent).toBe('見開きに戻す');
    expect(DOM.adjustSpreadBtn.style.display).toBe('none');
  });
});

describe('toolbar navigation', () => {
  it('shows folder controls only after entering a folder and disables favorite sorting in the favorite list', () => {
    let historyLength = 0;
    let favoriteList = false;
    const toolbar = createToolbar({
      upDirBtn: DOM.upDirBtn,
      copyPathBtn: DOM.copyPathBtn,
      reloadBtn: DOM.reloadBtn,
      listToolbar: DOM.listToolbar,
      currentDirName: DOM.currentDirName,
      recursiveBtn: DOM.recursiveBtn,
      favoriteListBtn: DOM.favoriteListBtn,
      toggleSortBtn: DOM.toggleSortBtn,
      favoriteModeSelect: DOM.favoriteModeSelect,
      hiddenModeBtn: DOM.hiddenModeBtn,
      uiVisibilityBtn: DOM.uiVisibilityBtn,
      viewerToolbar: DOM.viewerToolbar,
      getDirectoryHistoryLength: () => historyLength,
      getCurrentDirName: () => 'chapter',
      getIsRecursiveMode: () => false,
      getIsFavoriteListMode: () => favoriteList,
      setIsRecursiveMode: vi.fn(),
      getSortOrder: () => 'desc',
      getFavoriteFirst: () => false,
      getFavoriteOnly: () => true,
      getIsHiddenMode: () => false,
      getIsUiHidden: () => false,
      setToolbarHideTimer: vi.fn(),
      getToolbarHideTimer: () => null
    });
    toolbar.updateNavigationUI();
    expect(DOM.listToolbar.classList.contains('hidden')).toBe(true);
    historyLength = 2;
    favoriteList = true;
    toolbar.updateNavigationUI();
    expect(DOM.listToolbar.classList.contains('hidden')).toBe(false);
    expect(DOM.upDirBtn.classList.contains('hidden')).toBe(false);
    expect(DOM.currentDirName.textContent).toBe('chapter');
    expect(DOM.favoriteListBtn.textContent).toBe('戻る');
    expect(DOM.favoriteModeSelect.disabled).toBe(true);
    expect(DOM.favoriteModeSelect.value).toBe('only');
    expect(DOM.toggleSortBtn.textContent).toContain('降順');
  });
});
