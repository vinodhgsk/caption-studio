import React from 'react'
import ReactDOM from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import App from '@/App'
import Home from '@/routes/Home'
import Editor from '@/routes/Editor'
import { loadBundledFonts } from '@/store/fonts/loadBundledFonts'
import '@/index.css'

// Register the bundled font faces (Baloo Thambi 2 + Noto Indic) into
// document.fonts so the canvas shapes captions on-brand from first paint.
// Fire-and-forget; the preview redraws as fonts become ready.
void loadBundledFonts()

const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: 'editor', element: <Editor /> }
    ]
  }
])

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
