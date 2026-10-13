import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './lib/push';
import { adoptResumeLink } from './lib/session';
import './styles.css';

adoptResumeLink(); // opened from a "your move" notification → go straight to that game
void registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
