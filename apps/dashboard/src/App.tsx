import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { useSession } from './lib/session'
import { AuditPage } from './pages/AuditPage'
import { EnvironmentsPage } from './pages/EnvironmentsPage'
import { FlagDetailPage } from './pages/FlagDetailPage'
import { FlagsPage } from './pages/FlagsPage'
import { LoginPage } from './pages/LoginPage'

export function App() {
  const { session } = useSession()
  if (!session) return <LoginPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/flags" element={<FlagsPage />} />
        <Route path="/flags/:key" element={<FlagDetailPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/environments" element={<EnvironmentsPage />} />
        <Route path="*" element={<Navigate to="/flags" replace />} />
      </Route>
    </Routes>
  )
}
