/**
 * Module Management API
 *
 * GET /api/modules - List all user's modules
 * DELETE /api/modules?id={id} - Delete a module
 */

import { NextRequest, NextResponse } from 'next/server'
import { listModuleAssetStoragePaths, removeStorageObjects } from '@/lib/assets/storage-cleanup'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * GET - List all modules for authenticated user
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: modules, error: fetchError } = await supabase
      .from('modules')
      .select(
        'id, name, description, source_file, hide_icon, created_at, updated_at, lorebook, regex, assets',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (fetchError) {
      console.error('[Modules API] Failed to fetch modules:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch modules' }, { status: 500 })
    }

    // Add counts for each module
    const modulesWithCounts = (modules || []).map((mod) => ({
      id: mod.id,
      name: mod.name,
      description: mod.description,
      source_file: mod.source_file,
      hide_icon: mod.hide_icon,
      created_at: mod.created_at,
      updated_at: mod.updated_at,
      counts: {
        lorebook: Array.isArray(mod.lorebook) ? mod.lorebook.length : 0,
        regex: Array.isArray(mod.regex) ? mod.regex.length : 0,
        assets: Array.isArray(mod.assets) ? mod.assets.length : 0,
      },
    }))

    return NextResponse.json({
      success: true,
      modules: modulesWithCounts,
    })
  } catch (error) {
    console.error('[Modules API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE - Delete a module by ID
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const moduleId = searchParams.get('id')

    if (!moduleId) {
      return NextResponse.json({ error: 'Missing module ID' }, { status: 400 })
    }

    const moduleAssetPaths = await listModuleAssetStoragePaths(supabase, moduleId).catch(
      (error: Error) => {
        console.error('[Modules API] Failed to load module asset paths before delete:', {
          moduleId,
          userId: user.id,
          error: error.message,
        })
        return []
      },
    )

    // Delete module (RLS ensures user can only delete their own)
    const { error: deleteError } = await supabase
      .from('modules')
      .delete()
      .eq('id', moduleId)
      .eq('user_id', user.id)

    if (deleteError) {
      console.error('[Modules API] Failed to delete module:', deleteError)
      return NextResponse.json({ error: 'Failed to delete module' }, { status: 500 })
    }

    await removeStorageObjects(supabase, 'module-assets', moduleAssetPaths, {
      entityId: moduleId,
      entityType: 'module',
      operation: 'deleteModule',
    })

    return NextResponse.json({
      success: true,
      message: 'Module deleted successfully',
    })
  } catch (error) {
    console.error('[Modules API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
