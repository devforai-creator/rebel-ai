'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/app/dashboard/components/Button'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import { cx } from '@/app/dashboard/components/classNames'
import { IMPORT_UPLOAD_BUCKET, MAX_IMPORT_UPLOAD_MB } from '@/lib/import/constants'
import { createClient } from '@/lib/supabase/client'

type JobStatus = 'pending' | 'processing' | 'success' | 'error'

type ImportStats = {
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

const statusCopy: Record<JobStatus, string> = {
  pending: 'Job is waiting. Server will process it in order.',
  processing: 'Importing RBX package and uploading assets.',
  success: 'Import complete. Character list will refresh shortly.',
  error: 'Import failed. Please check the error message.',
}

function isSupportedRbxFile(file: File) {
  return file.name.toLowerCase().endsWith('.rbx')
}

function buildUploadPath(userId: string, file: File) {
  const sanitizedName = file.name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  const uniqueSuffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}`

  const safeName = sanitizedName || 'character.rbx'
  return `${userId}/imports/${uniqueSuffix}-${safeName}`
}

export default function CharacterImport() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [visibleJobId, setVisibleJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [importStats, setImportStats] = useState<ImportStats | null>(null)

  const showJobPanel = Boolean(visibleJobId || jobStatus)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedFile) {
      setError('Please select an RBX file.')
      return
    }

    if (!isSupportedRbxFile(selectedFile)) {
      setError('Supported files: .rbx only')
      return
    }

    if (selectedFile.size > MAX_IMPORT_UPLOAD_MB * 1024 * 1024) {
      setError(`File size must be ${MAX_IMPORT_UPLOAD_MB}MB or less.`)
      return
    }

    setError(null)
    setLoading(true)
    setImportStats(null)
    setJobId(null)
    setVisibleJobId(null)
    setJobStatus(null)
    setStatusMessage('Uploading RBX package to Supabase Storage...')

    try {
      const supabase = createClient()
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

      const response = await fetch('/api/characters/import/storage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: uploadResult.data.path,
          fileName: selectedFile.name,
          fileType: selectedFile.type,
          fileSize: selectedFile.size,
        }),
      })

      const result = await response.json()

      if (!response.ok || !result?.jobId) {
        throw new Error(result?.error || 'Import job enqueue failed')
      }

      setJobId(result.jobId as string)
      setVisibleJobId(result.jobId as string)
      setJobStatus((result.status as JobStatus) || 'pending')
      setStatusMessage('Preparing background import job...')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(`Import failed: ${message}`)
      setStatusMessage(null)
      setLoading(false)
      setVisibleJobId(null)
    }
  }

  useEffect(() => {
    if (!jobId) {
      return
    }

    let isSubscribed = true

    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/characters/import/jobs/${jobId}`)
        const data = await response.json()

        if (!isSubscribed) {
          return
        }

        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load job status')
        }

        setJobStatus(data.status as JobStatus)

        if (data.status === 'success') {
          if (data.result?.stats) {
            setImportStats(data.result.stats as ImportStats)
          }
          setStatusMessage('Import complete! Redirecting to character list...')
          setLoading(false)
          setJobId(null)
          return
        }

        if (data.status === 'error') {
          setError(data.error || 'Import failed')
          setStatusMessage(null)
          setLoading(false)
          setJobId(null)
          return
        }

        setStatusMessage(
          data.status === 'processing' ? 'Processing RBX package...' : 'Waiting in queue...',
        )
      } catch (err) {
        if (!isSubscribed) {
          return
        }
        setError(`Status check failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
        setStatusMessage(null)
        setLoading(false)
        setJobId(null)
        setVisibleJobId(null)
      }
    }

    void fetchStatus()
    const interval = setInterval(() => {
      void fetchStatus()
    }, 2500)

    return () => {
      isSubscribed = false
      clearInterval(interval)
    }
  }, [jobId])

  useEffect(() => {
    if (jobStatus !== 'success') {
      return
    }

    const timeout = setTimeout(() => {
      router.push('/dashboard/characters')
    }, 1500)

    return () => clearTimeout(timeout)
  }, [jobStatus, router])

  function handleDrag(event: React.DragEvent) {
    event.preventDefault()
    event.stopPropagation()

    if (event.type === 'dragenter' || event.type === 'dragover') {
      setDragActive(true)
    } else if (event.type === 'dragleave') {
      setDragActive(false)
    }
  }

  function selectFile(file: File) {
    if (!isSupportedRbxFile(file)) {
      setError('Supported files: .rbx only')
      return
    }

    setSelectedFile(file)
    setError(null)
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)

    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      selectFile(event.dataTransfer.files[0])
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files[0]) {
      selectFile(event.target.files[0])
    }
  }

  function handleBrowseClick() {
    fileInputRef.current?.click()
  }

  return (
    <SurfaceCard padding="none" className="p-8">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Import Character
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Upload an RBX package to import a RebelAI-native character, assets, and modules.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <InlineFeedback tone="error">{error}</InlineFeedback>}

        {showJobPanel && (
          <InlineFeedback tone="warning" className="space-y-1">
            <p className="font-medium">Background import job is in progress.</p>
            <p>
              {jobStatus
                ? statusCopy[jobStatus]
                : 'Preparing job... You can navigate away and the job will continue.'}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Job ID:{' '}
              <span className="font-mono">
                {((visibleJobId ?? jobId)?.slice(0, 8) ?? 'Waiting') +
                  ((visibleJobId ?? jobId) ? '...' : '')}
              </span>
            </p>
            {statusMessage ? <p className="text-xs">{statusMessage}</p> : null}
          </InlineFeedback>
        )}

        {importStats && (
          <InlineFeedback tone="success" className="space-y-1">
            <p className="font-medium">Import complete.</p>
            <p>
              Assets: {importStats.assetsUploaded ?? 0} · Modules: {importStats.modulesCreated ?? 0}{' '}
              · Lorebook entries: {importStats.lorebookEntries ?? 0} · Module assets:{' '}
              {importStats.moduleAssetsUploaded ?? 0}
            </p>
            {typeof importStats.failedAssets === 'number' && importStats.failedAssets > 0 ? (
              <p>Failed assets: {importStats.failedAssets}</p>
            ) : null}
          </InlineFeedback>
        )}

        {typeof importStats?.failedAssets === 'number' &&
          importStats.failedAssets > 0 &&
          importStats.failedAssetSamples &&
          importStats.failedAssetSamples.length > 0 && (
            <InlineFeedback tone="warning" className="space-y-1">
              <p className="font-medium">Some assets failed to import.</p>
              <ul className="list-disc ml-5 text-xs space-y-0.5">
                {importStats.failedAssetSamples.slice(0, 5).map((item, index) => (
                  <li key={`${item.fileName}-${index}`}>
                    <span className="font-mono break-all">{item.fileName}</span> — {item.reason}
                  </li>
                ))}
              </ul>
            </InlineFeedback>
          )}

        {importStats?.validationWarnings && importStats.validationWarnings.length > 0 && (
          <InlineFeedback tone="warning" className="space-y-1">
            <p className="font-medium">Imported with SUU compatibility warnings.</p>
            <ul className="list-disc ml-5 text-xs space-y-0.5">
              {importStats.validationWarnings.slice(0, 5).map((warning, index) => (
                <li key={`${warning}-${index}`} className="break-words">
                  {warning}
                </li>
              ))}
            </ul>
          </InlineFeedback>
        )}

        <div
          onClick={handleBrowseClick}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={cx(
            'relative cursor-pointer rounded-lg border-2 border-dashed p-8 transition-colors',
            dragActive
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500',
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".rbx"
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              stroke="currentColor"
              fill="none"
              viewBox="0 0 48 48"
              aria-hidden="true"
            >
              <path
                d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>

            {selectedFile ? (
              <div className="mt-4">
                <p className="text-sm font-medium text-gray-900 dark:text-white">Selected file:</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{selectedFile.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Click to select an RBX package or drag and drop it here
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  .rbx only (max {MAX_IMPORT_UPLOAD_MB}MB)
                </p>
              </div>
            )}
          </div>
        </div>

        <InlineFeedback tone="info">
          <h3 className="text-sm font-medium text-blue-900 dark:text-blue-400 mb-2">
            RBX Import Notes
          </h3>
          <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
            <li>* RBX is the native RebelAI package format.</li>
            <li>
              * Character assets, linked modules, lorebook entries, and UI card data import
              together.
            </li>
            <li>* Imports run as background jobs, so you can leave this page after upload.</li>
            <li>* Legacy compatibility import paths are no longer part of the public core.</li>
          </ul>
        </InlineFeedback>

        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            onClick={() => router.push('/dashboard/characters')}
            variant="secondary"
          >
            Cancel
          </Button>
          <Button type="submit" disabled={loading || !selectedFile}>
            {loading ? 'Importing...' : 'Import RBX'}
          </Button>
        </div>
      </form>
    </SurfaceCard>
  )
}
