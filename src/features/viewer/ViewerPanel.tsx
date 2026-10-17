import { useAppState } from '../../app/ApplicationProvider';
import { Viewer } from './Viewer';

export function ViewerPanel() {
  const presentation = useAppState((state) => state.viewer);
  const single = useAppState((state) => state.isSinglePageView);
  return <Viewer presentation={presentation} single={single} />;
}
