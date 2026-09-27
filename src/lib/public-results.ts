import { deriveStandings } from './standings'
import type { PublicResults } from '../schemas/public-results-schema'

// Explicit allowlist: never spread private record envelopes into public data.
export function buildPublicResults(
  name: string,
  ...inputs: Parameters<typeof deriveStandings>
): PublicResults {
  return {
    name,
    entries: deriveStandings(...inputs).map(({ name, score, scoreCount, rank, tied }) => ({
      name, score, scoreCount, rank, tied,
    })),
  }
}
