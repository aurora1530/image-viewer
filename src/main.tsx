import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createApplication } from './app/createApplication';
import { ApplicationProvider } from './app/ApplicationProvider';
import './style.css';

const root = createRoot(document.getElementById('app')!);
const application = createApplication();
root.render(
  <StrictMode>
    <ApplicationProvider application={application}>
      <App />
    </ApplicationProvider>
  </StrictMode>,
);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    root.unmount();
  });
