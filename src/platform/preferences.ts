import { normalizeTheme } from '../shared/model';

export function readPreferences() {
  return {
    theme: normalizeTheme(localStorage.getItem('theme')),
    thumbnailSizeIndex: Number.parseInt(localStorage.getItem('thumbnailSizeIndex') || '1', 10),
    denseGallery: localStorage.getItem('denseGallery') === '1',
    isSinglePageView: localStorage.getItem('isSinglePageView') === '1',
    isUiHidden: localStorage.getItem('isUiHidden') === '1',
  };
}

export function writePreference(name: string, value: string) {
  localStorage.setItem(name, value);
}
