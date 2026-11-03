type DesktopApi = NonNullable<Window['desktopApi']>;
const unsupported = (): never => {
  throw new Error('Unexpected desktop API call');
};

/** Complete contract with fail-fast defaults; tests override only the operations they exercise. */
export function createDesktopApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    getUpdateState: unsupported,
    checkForUpdates: unsupported,
    installUpdate: unsupported,
    confirmListMode: unsupported,
    onUpdateState: unsupported,
    onBeforeClose: unsupported,
    onNavigate: unsupported,
    readThumbnail: unsupported,
    writeThumbnail: unsupported,
    readAppConfig: unsupported,
    writeAppConfig: unsupported,
    cacheStats: unsupported,
    confirmRemoval: unsupported,
    chooseDirectory: unsupported,
    openRoot: unsupported,
    openDirectoryExternally: unsupported,
    getLibrary: unsupported,
    toggleFavoriteRoot: unsupported,
    removeRecent: unsupported,
    listDirectory: unsupported,
    readFile: unsupported,
    writeFile: unsupported,
    exists: unsupported,
    findFirstFile: unsupported,
    ...overrides,
  };
}
