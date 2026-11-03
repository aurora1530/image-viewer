declare const api: {
  createThumbnailStore(options: {
    cacheDirectory: () => string;
    requireAllowed: (file: string) => string;
    maxEntries?: number;
    maxBytes?: number;
  }): {
    clear(): Promise<void>;
    configure(value: number): Promise<void>;
    stats(): Promise<{ bytes: number }>;
    read(file: string, maxEdge?: unknown): Promise<{ version: string; bytes: Uint8Array | null }>;
    write(file: string, version: string, bytes: Uint8Array, maxEdge?: unknown): Promise<boolean>;
  };
};
export = api;
