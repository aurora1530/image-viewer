import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import type { Application } from './createApplication';
import type { AppState } from './store';

const ApplicationContext = createContext<Application | null>(null);

export function ApplicationProvider({
  application,
  children,
}: {
  application: Application;
  children: ReactNode;
}) {
  useEffect(() => application.start(), [application]);
  return <ApplicationContext value={application}>{children}</ApplicationContext>;
}

export function useApplication() {
  const application = useContext(ApplicationContext);
  if (!application) throw new Error('ApplicationProvider is required');
  return application;
}

export function useAppState<T>(selector: (state: AppState) => T): T {
  return useStore(useApplication().store, selector);
}

export function useAppActions() {
  return useApplication().actions;
}
