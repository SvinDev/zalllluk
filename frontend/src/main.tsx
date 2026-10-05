import '@ant-design/v5-patch-for-react-19'
import 'dayjs/locale/ru'
import './styles.css'

import dayjs from 'dayjs'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'

dayjs.locale('ru')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
