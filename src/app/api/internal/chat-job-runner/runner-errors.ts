import type { ChatJobLifecycleStage } from '@/lib/chat/job-lifecycle'

export class ChatJobExecutionError extends Error {
  lifecycleStage: ChatJobLifecycleStage

  constructor(message: string, lifecycleStage: ChatJobLifecycleStage) {
    super(message)
    this.name = 'ChatJobExecutionError'
    this.lifecycleStage = lifecycleStage
  }
}
