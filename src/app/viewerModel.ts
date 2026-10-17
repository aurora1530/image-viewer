export type ViewerPresentation = {
  mode: 'closed' | 'image' | 'video';
  left: string | null;
  right: string | null;
  video: string | null;
  loading: string;
  counter: string;
  playback: { time: number; paused: boolean } | null;
};
