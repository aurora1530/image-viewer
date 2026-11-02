declare const api: {
  findFirstFile(
    directory: unknown,
    names: unknown,
    requireAllowed: (target: string) => string,
  ): Promise<string | null>;
};
export = api;
