declare const api: {
  createThumbnailStore(options: {
    cacheDirectory: () => string;
    requireAllowed: (file: string) => string;
    maxEntries?: number;
    maxBytes?: number;
  }): {
    configure(value: number): Promise<void>;
    stats(): Promise<{ bytes: number }>;
    read(file: string): Promise<{ version: string; bytes: Uint8Array | null }>;
    write(file: string, version: string, bytes: Uint8Array): Promise<boolean>;
  };
};
export = api;
