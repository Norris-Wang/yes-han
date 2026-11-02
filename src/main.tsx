import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'

import App from './App.tsx'

import ReviewSessionSandbox from "./pages/ReviewSessionSandbox";
import FsrsIntegrationSandbox from "./pages/FsrsIntegrationSandbox";

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        {import.meta.env.DEV &&
            new URLSearchParams(
                window.location.search
            ).has("integration-test") ? (
            <FsrsIntegrationSandbox />
        ) : import.meta.env.DEV &&
            new URLSearchParams(
                window.location.search
            ).has("review-test") ? (
            <ReviewSessionSandbox />
        ) : (
            <App />
        )}
    </StrictMode>,
)
