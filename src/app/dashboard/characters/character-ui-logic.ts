import { MAX_IMPORT_UPLOAD_MB } from '@/lib/import/constants'
import { buildImportUploadPath } from '@/lib/import/upload-path'

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

type CharacterImportFetchResponse = {
  ok: boolean
  json: () => Promise<unknown>
  text?: () => Promise<string>
}

type CharacterImportFetch = (
  input: string | URL,
  init?: {
    method?: string
    headers?: HeadersInit
    body?: BodyInit | null
  },
) => Promise<CharacterImportFetchResponse>

type CharacterImportUploadContract = {
  path: string
  signedUrl: string
  token: string
  uploadTicket: string
}

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

export const buildUploadPath = buildImportUploadPath

export function buildCharacterImportContractRequestBody(file: UploadableFile) {
  return {
    action: 'prepare' as const,
    fileName: file.name,
    fileType: file.type || null,
    fileSize: file.size,
  }
}

export function buildCharacterImportRequestBody(
  contract: Pick<CharacterImportUploadContract, 'path' | 'uploadTicket'>,
  file: UploadableFile,
) {
  return {
    action: 'enqueue' as const,
    path: contract.path,
    fileName: file.name,
    fileType: file.type || null,
    fileSize: file.size,
    uploadTicket: contract.uploadTicket,
  }
}

export function getCharacterImportErrorMessage(error: unknown, prefix = 'Import failed') {
  const message = error instanceof Error ? error.message : 'Unknown error'
  return `${prefix}: ${message}`
}

async function readCharacterImportApiError(
  response: CharacterImportFetchResponse,
  fallback: string,
): Promise<string> {
  try {
    const body = await response.json()
    if (body && typeof body === 'object') {
      if ('error' in body && typeof body.error === 'string') {
        return body.error
      }
      if ('message' in body && typeof body.message === 'string') {
        return body.message
      }
    }
  } catch {
    // Ignore and fall through.
  }

  if (typeof response.text === 'function') {
    try {
      const text = await response.text()
      if (text) {
        return text
      }
    } catch {
      // Ignore and fall through.
    }
  }

  return fallback
}

async function uploadCharacterImportFile({
  contract,
  selectedFile,
  fetchImpl,
}: {
  contract: CharacterImportUploadContract
  selectedFile: File
  fetchImpl: CharacterImportFetch
}) {
  const formData = new FormData()
  formData.append('cacheControl', '3600')
  formData.append('', selectedFile)

  const response = await fetchImpl(contract.signedUrl, {
    method: 'PUT',
    headers: {
      'x-upsert': 'false',
    },
    body: formData,
  })

  if (!response.ok) {
    throw new Error(await readCharacterImportApiError(response, 'File upload failed'))
  }
}

export async function startCharacterImportJob({
  selectedFile,
  fetchImpl,
}: {
  selectedFile: File | null
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
    const contractResponse = await fetchImpl('/api/characters/import/storage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildCharacterImportContractRequestBody(selectedFile)),
    })

    const contractResult =
      (await contractResponse.json()) as Partial<CharacterImportUploadContract> & {
        error?: string
      }

    if (
      !contractResponse.ok ||
      !contractResult.path ||
      !contractResult.signedUrl ||
      !contractResult.token ||
      !contractResult.uploadTicket
    ) {
      throw new Error(contractResult.error || 'Upload contract request failed')
    }

    await uploadCharacterImportFile({
      contract: {
        path: contractResult.path,
        signedUrl: contractResult.signedUrl,
        token: contractResult.token,
        uploadTicket: contractResult.uploadTicket,
      },
      selectedFile,
      fetchImpl,
    })

    const response = await fetchImpl('/api/characters/import/storage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        buildCharacterImportRequestBody(
          {
            path: contractResult.path,
            uploadTicket: contractResult.uploadTicket,
          },
          selectedFile,
        ),
      ),
    })

    const result = (await response.json()) as {
      jobId?: string
      status?: CharacterImportJobStatus
      error?: string
    }

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
