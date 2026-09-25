import '@fontsource/alfa-slab-one/400.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/600.css';
import '@drunkify/content/css/tokens.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <main className="shell">
      <p className="eyebrow">Trip drink log</p>
      <h1>Drunkify</h1>
      <p>The M0 scaffold is alive. Logging starts in a later milestone.</p>
    </main>
  );
}

const root = document.querySelector('#root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
