import { useAppState } from '../../app/ApplicationProvider';
export function StatusArea() {
  const status = useAppState((state) => state.status);
  const preview = useAppState((state) => state.scanPreview);
  const home = useAppState((state) => state.screen === 'home');
  const variant =
    status.type === 'error'
      ? 'status-error'
      : status.type === 'info'
        ? 'status-info'
        : 'status-default';
  return (
    <div
      id="status-area"
      className={`${status.type === 'clear' ? '' : `status-area ${variant}`}${home ? ' hidden' : ''}`}
    >
      {status.type === 'loading' && <div className="loader mx-auto" />}
      {status.message && <p className="status-message">{status.message}</p>}
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
