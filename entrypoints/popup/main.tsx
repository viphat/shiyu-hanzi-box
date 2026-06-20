import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../styles.css';

// Minimal placeholder popup. Replaced by the full Popup component in Task 7.
function Popup() {
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 14 }}>拾语汉字box</h1>
      <p style={{ fontSize: 12, color: '#6b7280' }}>Loading…</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
