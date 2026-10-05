import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import ruRU from 'antd/locale/ru_RU'
import { lazy } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'

import { AuthProvider } from '@/auth/AuthProvider'
import { RequireAuth, RequireRole } from '@/auth/RequireAuth'
import { ACCOUNTANTS, MANAGERS, STAFF } from '@/auth/useAuth'
import { AppLayout } from '@/layout/AppLayout'
import { HomePage } from '@/pages/HomePage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

const BuildingsPage = lazy(() => import('@/pages/housing/BuildingsPage'))
const ApartmentsPage = lazy(() => import('@/pages/housing/ApartmentsPage'))
const ApartmentPage = lazy(() => import('@/pages/housing/ApartmentPage'))
const UsersPage = lazy(() => import('@/pages/housing/UsersPage'))
const MetersPage = lazy(() => import('@/pages/meters/MetersPage'))
const ReadingsJournalPage = lazy(() => import('@/pages/meters/ReadingsJournalPage'))
const BillingPage = lazy(() => import('@/pages/billing/BillingPage'))
const TariffsPage = lazy(() => import('@/pages/billing/TariffsPage'))
const InvoicesPage = lazy(() => import('@/pages/billing/InvoicesPage'))
const InvoicePage = lazy(() => import('@/pages/billing/InvoicePage'))
const PaymentsPage = lazy(() => import('@/pages/billing/PaymentsPage'))
const DebtorsPage = lazy(() => import('@/pages/billing/DebtorsPage'))

const OFFICE = ['admin', 'manager', 'accountant'] as const

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'buildings', element: <RequireRole roles={OFFICE}><BuildingsPage /></RequireRole> },
      { path: 'apartments', element: <RequireRole roles={OFFICE}><ApartmentsPage /></RequireRole> },
      { path: 'apartments/:id', element: <RequireRole roles={STAFF}><ApartmentPage /></RequireRole> },
      { path: 'users', element: <RequireRole roles={MANAGERS}><UsersPage /></RequireRole> },
      { path: 'meters', element: <MetersPage /> },
      { path: 'readings', element: <RequireRole roles={OFFICE}><ReadingsJournalPage /></RequireRole> },
      { path: 'billing', element: <RequireRole roles={ACCOUNTANTS}><BillingPage /></RequireRole> },
      { path: 'tariffs', element: <RequireRole roles={OFFICE}><TariffsPage /></RequireRole> },
      { path: 'invoices', element: <InvoicesPage /> },
      { path: 'invoices/:id', element: <InvoicePage /> },
      { path: 'payments', element: <PaymentsPage /> },
      { path: 'debtors', element: <RequireRole roles={OFFICE}><DebtorsPage /></RequireRole> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
  },
})

export function App() {
  return (
    <ConfigProvider locale={ruRU} theme={{ token: { colorPrimary: '#1677ff', borderRadius: 8 } }}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  )
}
