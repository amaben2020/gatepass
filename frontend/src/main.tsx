import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// No StrictMode: it runs effects twice in development, which would show every request twice in the log.
createRoot(document.getElementById('root')!).render(<App />);
