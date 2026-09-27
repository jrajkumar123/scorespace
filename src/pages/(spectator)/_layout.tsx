import { Outlet } from 'react-router-dom'
import { DeepSpaceAuthProvider, RecordProvider, RecordScope, useAuthStatus } from 'deepspace'
import { SCOPE_ID } from '@/constants'
import { publicResultsSchema } from '@/schemas/public-results-schema'

// Even an already signed-in visitor uses an anonymous record connection here.
// The spectator socket cannot receive private records or the user roster.
const anonymousToken = async () => null
const publicSchemas = [publicResultsSchema]

export default function SpectatorLayout() {
  return <DeepSpaceAuthProvider><SpectatorData /></DeepSpaceAuthProvider>
}

function SpectatorData() {
  const { isLoaded } = useAuthStatus()
  if (!isLoaded) return <p role="status" className="p-8 text-center">Connecting to live results…</p>
  return (
    <RecordProvider allowAnonymous getAuthToken={anonymousToken}>
      <RecordScope roomId={SCOPE_ID} schemas={publicSchemas}>
        <Outlet />
      </RecordScope>
    </RecordProvider>
  )
}
