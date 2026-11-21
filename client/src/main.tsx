import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import { registerCatanWorker } from './push';
import { unlockAudio } from './audio';

if (!location.pathname.startsWith('/catan')) {
  registerCatanWorker();
}

const primeAudio = () => unlockAudio();
window.addEventListener('pointerdown', primeAudio, { once: true });
window.addEventListener('keydown', primeAudio, { once: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
