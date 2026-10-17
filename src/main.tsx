import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startApplication } from './application';
import './style.css';

const root = createRoot(document.getElementById('app')!);
const stop = startApplication();
root.render(<StrictMode><App /></StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => { root.unmount(); stop(); });
