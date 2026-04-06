import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'edge'
export const revalidate = 0

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: jobId } = await context.params

    if (!jobId) {
      return NextResponse.json({ error: 'Job id is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: job, error } = await supabase
      .from('chat_generation_jobs')
      .select('id, chat_id, status, error, created_at, updated_at')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single()

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json({
      id: job.id,
      chatId: job.chat_id,
      status: job.status,
      error: job.error,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    })
  } catch (error) {
    console.error('[Chat Jobs API] Failed to load job status', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
