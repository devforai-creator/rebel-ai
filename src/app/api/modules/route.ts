/**
 * Module Management API
 *
 * GET /api/modules - List all user's modules
 * DELETE /api/modules?id={id} - Delete a module
 */

import {
  createApiErrorResponse,
  createUnexpectedRouteErrorResponse,
  requireAuthenticatedUser,
} from '@/lib/http/api-contract'
import { listModuleAssetStoragePaths, removeStorageObjects } from '@/lib/assets/storage-cleanup'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * GET - List all modules for authenticated user
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuthenticatedUser(supabase)
    if (!auth.success) {
      return auth.response
    }
    const { user } = auth

    const { data: modules, error: fetchError } = await supabase
      .from('modules')
      .select(
        'id, name, description, source_file, hide_icon, created_at, updated_at, lorebook, regex, assets',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (fetchError) {
      console.error('[Modules API] Failed to fetch modules:', fetchError)
      return createApiErrorResponse('Failed to fetch modules', 500)
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

    return Response.json({
      success: true,
      modules: modulesWithCounts,
    })
  } catch (error) {
    return createUnexpectedRouteErrorResponse('[Modules API] Unexpected error:', error)
  }
}

/**
 * DELETE - Delete a module by ID
 */
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireAuthenticatedUser(supabase)
    if (!auth.success) {
      return auth.response
    }
    const { user } = auth

    const { searchParams } = new URL(request.url)
    const moduleId = searchParams.get('id')

    if (!moduleId) {
      return createApiErrorResponse('Missing module ID', 400)
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
      return createApiErrorResponse('Failed to delete module', 500)
    }

    let warning: string | undefined

    try {
      await removeStorageObjects(supabase, 'module-assets', moduleAssetPaths, {
        entityId: moduleId,
        entityType: 'module',
        operation: 'deleteModule',
      })
    } catch (error) {
      console.error('[Modules API] Module deleted but storage cleanup failed:', {
        moduleId,
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      })
      warning =
        'Module deleted, but some asset cleanup failed. The storage janitor can remove leftovers.'
    }

    return Response.json({
      success: true,
      message: 'Module deleted successfully',
      ...(warning ? { warning } : {}),
    })
  } catch (error) {
    return createUnexpectedRouteErrorResponse('[Modules API] Unexpected error:', error)
  }
}
