import { useEffect } from 'react';
import { useAppActions } from './ApplicationProvider';
export function useLayoutClasses(hidden: boolean, revealed: boolean) {
  const actions = useAppActions();
  useEffect(() => {
    document.body.classList.toggle('ui-hidden-mode', hidden);
    document.body.classList.toggle('ui-dock-revealed', hidden && revealed);
    return () => {
      document.body.classList.remove('ui-hidden-mode', 'ui-dock-revealed');
    };
  }, [hidden, revealed]);
  useEffect(() => {
    const move = (event: MouseEvent) =>
      actions.revealDock(event.clientY >= Math.max(window.innerHeight - 120, 0));
    const leave = () => actions.revealDock(false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseleave', leave);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseleave', leave);
    };
  }, [actions]);
}
