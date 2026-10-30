import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startLiveReload } from './data/live';
import './theme/theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('proofmap: #root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void startLiveReload();
