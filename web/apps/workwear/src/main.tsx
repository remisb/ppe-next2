import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app'
import './index.css'
import { ApiProvider } from './lib/api'

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <ApiProvider>
      <App />
    </ApiProvider>
  </StrictMode>,
)
