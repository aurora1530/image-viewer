export function readPreferences() {
  return {
    thumbnailSizeIndex: Number.parseInt(localStorage.getItem('thumbnailSizeIndex') || '1', 10),
    isSinglePageView: localStorage.getItem('isSinglePageView') === '1',
    isUiHidden: localStorage.getItem('isUiHidden') === '1',
  };
}

export function writePreference(name: string, value: string) {
  localStorage.setItem(name, value);
}
