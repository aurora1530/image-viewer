declare const api: {
  serveMedia(request: Request, filePath: string): Promise<Response>;
};
export = api;
