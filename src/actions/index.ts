import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { addCompetitor } from './add-competitor'

export const actions: Record<string, ActionHandler<Env>> = { addCompetitor }
