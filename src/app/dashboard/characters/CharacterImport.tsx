'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/app/dashboard/components/Button'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import { cx } from '@/app/dashboard/components/classNames'
import { MAX_IMPORT_UPLOAD_MB } from '@/lib/import/constants'
import { createClient } from '@/lib/supabase/client'
import {
  characterImportStatusCopy,
  getCharacterImportErrorMessage,
  getCharacterImportSelectionError,
  resolveCharacterImportJobProgress,
  startCharacterImportJob,
  type CharacterImportJobStatus,
  type CharacterImportStats,
} from './character-ui-logic'

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
  const [jobStatus, setJobStatus] = useState<CharacterImportJobStatus | null>(null)
  const [importStats, setImportStats] = useState<CharacterImportStats | null>(null)

  const showJobPanel = Boolean(visibleJobId || jobStatus)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setError(null)
    setLoading(true)
    setImportStats(null)
    setJobId(null)
    setVisibleJobId(null)
    setJobStatus(null)
    setStatusMessage('Uploading RBX package to Supabase Storage...')

    const result = await startCharacterImportJob({
      selectedFile,
      supabase: createClient(),
      fetchImpl: fetch,
    })

    if (!result.ok) {
      setError(result.error)
      setStatusMessage(null)
      setLoading(false)
      setVisibleJobId(null)
      return
    }

    setJobId(result.jobId)
    setVisibleJobId(result.jobId)
    setJobStatus(result.jobStatus)
    setStatusMessage(result.statusMessage)
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

        const nextState = resolveCharacterImportJobProgress({
          ok: response.ok,
          data,
        })

        setJobStatus(nextState.jobStatus)

        if (nextState.kind === 'success') {
          setImportStats(nextState.importStats)
          setStatusMessage(nextState.statusMessage)
          setLoading(false)
          setJobId(null)
          return
        }

        if (nextState.kind === 'error') {
          setError(nextState.error)
          setStatusMessage(null)
          setLoading(false)
          setJobId(null)
          return
        }

        setStatusMessage(nextState.statusMessage)
      } catch (err) {
        if (!isSubscribed) {
          return
        }
        setError(getCharacterImportErrorMessage(err, 'Status check failed'))
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
    const selectionError = getCharacterImportSelectionError(file)
    if (selectionError) {
      setError(selectionError)
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
                ? characterImportStatusCopy[jobStatus]
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
