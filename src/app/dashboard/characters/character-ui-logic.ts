import { IMPORT_UPLOAD_BUCKET, MAX_IMPORT_UPLOAD_MB } from '@/lib/import/constants'

export type CharacterImportJobStatus = 'pending' | 'processing' | 'success' | 'error'

export type CharacterImportStats = {
  assetsUploaded?: number
  failedAssets?: number
  failedAssetSamples?: Array<{
    fileName: string
    reason: string
  }>
  modulesCreated?: number
  lorebookEntries?: number
  moduleAssetsUploaded?: number
  validationWarnings?: string[]
}

type UploadableFile = {
  name: string
  size: number
  type?: string
}

type CharacterFormActionResult = { error?: string | null } | undefined

type CharacterFormSubmitParams = {
  characterId?: string
  formData: FormData
  isEditing: boolean
  selectedModuleIds: string[]
  createCharacterImpl: (formData: FormData) => Promise<CharacterFormActionResult>
  updateCharacterImpl: (id: string, formData: FormData) => Promise<CharacterFormActionResult>
}

type DeleteCharacterResult = { error?: string | null; warning?: string | null } | undefined

type DeleteCharacterParams = {
  characterId: string
  deleteCharacterImpl: (id: string) => Promise<DeleteCharacterResult>
}

type CharacterImportSupabase = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string } | null }
      error?: { message?: string } | null
    }>
  }
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File,
        options?: {
          upsert?: boolean
          cacheControl?: string
          contentType?: string
        },
      ) => Promise<{
        data?: { path: string } | null
        error?: { message?: string } | null
      }>
    }
  }
}

type CharacterImportFetch = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
  },
) => Promise<{
  ok: boolean
  json: () => Promise<{ jobId?: string; status?: CharacterImportJobStatus; error?: string }>
}>

export const characterImportStatusCopy: Record<CharacterImportJobStatus, string> = {
  pending: 'Job is waiting. Server will process it in order.',
  processing: 'Importing RBX package and uploading assets.',
  success: 'Import complete. Character list will refresh shortly.',
  error: 'Import failed. Please check the error message.',
}

export function isSupportedRbxFile(file: Pick<UploadableFile, 'name'>) {
  return file.name.toLowerCase().endsWith('.rbx')
}

export function getCharacterImportSelectionError(file: UploadableFile) {
  return isSupportedRbxFile(file) ? null : 'Supported files: .rbx only'
}

export function getCharacterImportValidationError(file: UploadableFile | null) {
  if (!file) {
    return 'Please select an RBX file.'
  }

  if (!isSupportedRbxFile(file)) {
    return 'Supported files: .rbx only'
  }

  if (file.size > MAX_IMPORT_UPLOAD_MB * 1024 * 1024) {
    return `File size must be ${MAX_IMPORT_UPLOAD_MB}MB or less.`
  }

  return null
}

export function buildUploadPath(
  userId: string,
  file: Pick<UploadableFile, 'name'>,
  createUniqueSuffix: () => string = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}`,
) {
  const sanitizedName = file.name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-\.(?=[^.]+$)/, '.')

  const safeName = sanitizedName || 'character.rbx'
  return `${userId}/imports/${createUniqueSuffix()}-${safeName}`
}

export function buildCharacterImportRequestBody(path: string, file: UploadableFile) {
  return {
    path,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  }
}

export function getCharacterImportErrorMessage(error: unknown, prefix = 'Import failed') {
  const message = error instanceof Error ? error.message : 'Unknown error'
  return `${prefix}: ${message}`
}

export async function startCharacterImportJob({
  selectedFile,
  supabase,
  fetchImpl,
}: {
  selectedFile: File | null
  supabase: CharacterImportSupabase
  fetchImpl: CharacterImportFetch
}) {
  const validationError = getCharacterImportValidationError(selectedFile)
  if (validationError || !selectedFile) {
    return {
      ok: false as const,
      error: validationError ?? 'Please select an RBX file.',
    }
  }

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      throw new Error('Login required')
    }

    const uploadPath = buildUploadPath(user.id, selectedFile)
    const uploadResult = await supabase.storage
      .from(IMPORT_UPLOAD_BUCKET)
      .upload(uploadPath, selectedFile, {
        upsert: false,
        cacheControl: '3600',
        contentType: selectedFile.type || 'application/octet-stream',
      })

    if (uploadResult.error || !uploadResult.data) {
      throw new Error(uploadResult.error?.message || 'File upload failed')
    }

    const response = await fetchImpl('/api/characters/import/storage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildCharacterImportRequestBody(uploadResult.data.path, selectedFile)),
    })

    const result = await response.json()

    if (!response.ok || !result?.jobId) {
      throw new Error(result?.error || 'Import job enqueue failed')
    }

    return {
      ok: true as const,
      jobId: result.jobId,
      jobStatus: (result.status as CharacterImportJobStatus) || 'pending',
      statusMessage: 'Preparing background import job...',
    }
  } catch (error) {
    return {
      ok: false as const,
      error: getCharacterImportErrorMessage(error),
    }
  }
}

export function resolveCharacterImportJobProgress({
  ok,
  data,
}: {
  ok: boolean
  data: {
    status?: CharacterImportJobStatus
    result?: { stats?: CharacterImportStats } | null
    error?: string | null
  }
}) {
  if (!ok) {
    throw new Error(data?.error || 'Failed to load job status')
  }

  const status = data.status as CharacterImportJobStatus

  if (status === 'success') {
    return {
      kind: 'success' as const,
      jobStatus: status,
      importStats: data.result?.stats ?? null,
      statusMessage: 'Import complete! Redirecting to character list...',
    }
  }

  if (status === 'error') {
    return {
      kind: 'error' as const,
      error: data.error || 'Import failed',
      jobStatus: status,
    }
  }

  return {
    kind: 'progress' as const,
    jobStatus: status,
    statusMessage: status === 'processing' ? 'Processing RBX package...' : 'Waiting in queue...',
  }
}

export function toggleSelectedModuleIds(selectedModuleIds: string[], moduleId: string) {
  return selectedModuleIds.includes(moduleId)
    ? selectedModuleIds.filter((id) => id !== moduleId)
    : [...selectedModuleIds, moduleId]
}

export async function submitCharacterForm({
  characterId,
  formData,
  isEditing,
  selectedModuleIds,
  createCharacterImpl,
  updateCharacterImpl,
}: CharacterFormSubmitParams) {
  formData.append('module_ids', selectedModuleIds.join(','))

  if (isEditing && characterId) {
    return updateCharacterImpl(characterId, formData)
  }

  return createCharacterImpl(formData)
}

export async function runCharacterDelete({
  characterId,
  deleteCharacterImpl,
}: DeleteCharacterParams) {
  return deleteCharacterImpl(characterId)
}
