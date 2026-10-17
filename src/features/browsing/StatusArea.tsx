import { useAppState } from '../../app/ApplicationProvider';
export function StatusArea() {
  const status = useAppState((state) => state.status);
  const preview = useAppState((state) => state.scanPreview);
  const home = useAppState((state) => state.screen === 'home');
  const color =
    status.type === 'error'
      ? 'bg-red-900 text-red-200'
      : status.type === 'info'
        ? 'bg-blue-900 text-blue-200'
        : 'text-gray-300';
  return (
    <div
      id="status-area"
      className={`${status.type === 'clear' ? '' : `text-center my-8 p-4 rounded-lg ${color}`}${home ? ' hidden' : ''}`}
    >
      {status.type === 'loading' && <div className="loader mx-auto" />}
      {status.message && <p className="mt-2">{status.message}</p>}
      {preview && (
        <img
          className="scan-preview"
          src={preview.url}
          alt={preview.name}
          title="画像を開く"
          onClick={preview.open}
        />
      )}
    </div>
  );
}
