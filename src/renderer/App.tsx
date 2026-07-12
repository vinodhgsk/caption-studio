import { Outlet } from 'react-router-dom'

export default function App(): JSX.Element {
  return (
    <div className="min-h-screen bg-surface-0 text-text-primary">
      <Outlet />
    </div>
  )
}
