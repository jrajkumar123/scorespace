import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { addCompetitor } from './add-competitor'
import { addJudge } from './add-judge'
import { submitScore } from './submit-score'

export const actions: Record<string, ActionHandler<Env>> = { addCompetitor, submitScore, addJudge }
