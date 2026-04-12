'use client'

import { useMemo, useState, useTransition } from 'react'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import { runConfirmedAction } from '@/app/dashboard/components/confirm-action'
import { CheckCircle2, Megaphone, PauseCircle, RefreshCw, Trash2, Pencil } from 'lucide-react'
import type { Announcement, AnnouncementSeverity } from '@/types/database.types'
import {
  createAnnouncement,
  updateAnnouncement,
  toggleAnnouncementStatus,
  deleteAnnouncement,
} from './actions'

export type AnnouncementListItem = Pick<
  Announcement,
  | 'id'
  | 'message'
  | 'cta_label'
  | 'cta_url'
  | 'severity'
  | 'is_active'
  | 'starts_at'
  | 'ends_at'
  | 'created_at'
  | 'updated_at'
>

interface Props {
  initialAnnouncements: AnnouncementListItem[]
}

type FormState = {
  message: string
  severity: AnnouncementSeverity
  ctaLabel: string
  ctaUrl: string
  startsAt: string
  endsAt: string
  isActive: boolean
}

const INITIAL_FORM_STATE: FormState = {
  message: '',
  severity: 'info',
  ctaLabel: '',
  ctaUrl: '',
  startsAt: '',
  endsAt: '',
  isActive: true,
}

const severityLabels: Record<AnnouncementSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
}

const severityStyles: Record<AnnouncementSeverity, { badge: string; tag: string }> = {
  info: {
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    tag: 'text-blue-600 dark:text-blue-300',
  },
  warning: {
    badge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200',
    tag: 'text-yellow-500 dark:text-yellow-300',
  },
  critical: {
    badge: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
    tag: 'text-red-500 dark:text-red-300',
  },
}

function toLocalInputValue(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function localInputToIso(value: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function formatDate(date: string | null) {
  if (!date) return 'Not set'
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return 'Not set'
  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AnnouncementAdminPanel({ initialAnnouncements }: Props) {
  const [announcements, setAnnouncements] = useState<AnnouncementListItem[]>(initialAnnouncements)
  const [formState, setFormState] = useState<FormState>(INITIAL_FORM_STATE)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isFormPending, startFormTransition] = useTransition()
  const [isRowPending, startRowTransition] = useTransition()
  const [rowActionId, setRowActionId] = useState<string | null>(null)
  const [pendingDeleteAnnouncementId, setPendingDeleteAnnouncementId] = useState<string | null>(
    null,
  )

  const activeCount = useMemo(
    () => announcements.filter((a) => a.is_active).length,
    [announcements],
  )

  const resetForm = () => {
    setEditingId(null)
    setFormState(INITIAL_FORM_STATE)
  }

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text })
    setTimeout(() => setFeedback(null), 4000)
  }

  const handleSubmit = () => {
    if (!formState.message.trim()) {
      showFeedback('error', 'Please enter announcement content.')
      return
    }

    startFormTransition(async () => {
      const payload = {
        message: formState.message,
        severity: formState.severity,
        ctaLabel: formState.ctaLabel || null,
        ctaUrl: formState.ctaUrl || null,
        startsAt: localInputToIso(formState.startsAt),
        endsAt: localInputToIso(formState.endsAt),
        isActive: formState.isActive,
      }

      const result = editingId
        ? await updateAnnouncement(editingId, payload)
        : await createAnnouncement(payload)

      if ('error' in result && result.error) {
        showFeedback('error', result.error)
        return
      }

      if ('announcement' in result && result.announcement) {
        const updatedAnnouncement = result.announcement
        setAnnouncements((prev) => {
          if (editingId) {
            return prev.map((ann) => (ann.id === editingId ? updatedAnnouncement : ann))
          }
          return [updatedAnnouncement, ...prev]
        })
      }

      showFeedback('success', editingId ? 'Announcement updated.' : 'New announcement created.')
      resetForm()
    })
  }

  const handleEdit = (announcement: AnnouncementListItem) => {
    setEditingId(announcement.id)
    setFormState({
      message: announcement.message,
      severity: announcement.severity,
      ctaLabel: announcement.cta_label ?? '',
      ctaUrl: announcement.cta_url ?? '',
      startsAt: toLocalInputValue(announcement.starts_at),
      endsAt: toLocalInputValue(announcement.ends_at),
      isActive: announcement.is_active,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleToggle = (announcement: AnnouncementListItem) => {
    setRowActionId(announcement.id)
    startRowTransition(async () => {
      const result = await toggleAnnouncementStatus(announcement.id, !announcement.is_active)
      if (result.error) {
        showFeedback('error', result.error)
      } else {
        setAnnouncements((prev) =>
          prev.map((item) =>
            item.id === announcement.id ? { ...item, is_active: !item.is_active } : item,
          ),
        )
        showFeedback(
          'success',
          !announcement.is_active ? 'Announcement activated.' : 'Announcement deactivated.',
        )
      }
      setRowActionId(null)
    })
  }

  const handleDelete = (announcementId: string) => {
    setPendingDeleteAnnouncementId(announcementId)
  }

  const confirmDelete = () => {
    const targetId = pendingDeleteAnnouncementId
    setPendingDeleteAnnouncementId(null)

    void runConfirmedAction(targetId, async (announcementId) => {
      setRowActionId(announcementId)
      startRowTransition(async () => {
        const result = await deleteAnnouncement(announcementId)
        if (result.error) {
          showFeedback('error', result.error)
        } else {
          setAnnouncements((prev) => prev.filter((item) => item.id !== announcementId))
          showFeedback('success', 'Announcement deleted.')
          if (editingId === announcementId) {
            resetForm()
          }
        }
        setRowActionId(null)
      })
    })
  }

  return (
    <div className="space-y-8">
      <section className="bg-white dark:bg-gray-800 shadow-sm rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {editingId ? 'Edit Announcement' : 'New Announcement'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Notify users immediately about urgent situations or major updates.
            </p>
          </div>
          {editingId && (
            <button
              onClick={resetForm}
              className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            >
              <RefreshCw className="w-4 h-4" />
              Switch to new announcement
            </button>
          )}
        </div>

        {feedback && (
          <div
            className={`mb-4 rounded-lg p-3 text-sm border ${
              feedback.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Announcement Content
              </label>
              <textarea
                value={formState.message}
                onChange={(e) => setFormState((prev) => ({ ...prev, message: e.target.value }))}
                rows={6}
                maxLength={1500}
                placeholder="e.g., Server restart scheduled between 2:00-3:00 AM on Nov 20 (Wed)."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {formState.message.length}/1500 chars
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Severity
                </label>
                <select
                  value={formState.severity}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      severity: e.target.value as AnnouncementSeverity,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                >
                  <option value="info">Info (Blue)</option>
                  <option value="warning">Warning (Yellow)</option>
                  <option value="critical">Critical (Red)</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  id="announcement-active"
                  type="checkbox"
                  checked={formState.isActive}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, isActive: e.target.checked }))
                  }
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label
                  htmlFor="announcement-active"
                  className="text-sm text-gray-700 dark:text-gray-300"
                >
                  Publish immediately
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  CTA Button Label
                </label>
                <input
                  type="text"
                  value={formState.ctaLabel}
                  onChange={(e) => setFormState((prev) => ({ ...prev, ctaLabel: e.target.value }))}
                  placeholder="e.g., Learn More"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  CTA URL
                </label>
                <input
                  type="text"
                  value={formState.ctaUrl}
                  onChange={(e) => setFormState((prev) => ({ ...prev, ctaUrl: e.target.value }))}
                  placeholder="Start with https:// or /"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Start Time (Optional)
              </label>
              <input
                type="datetime-local"
                value={formState.startsAt}
                onChange={(e) => setFormState((prev) => ({ ...prev, startsAt: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                If empty, it will be shown immediately upon saving.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                End Time (Optional)
              </label>
              <input
                type="datetime-local"
                value={formState.endsAt}
                onChange={(e) => setFormState((prev) => ({ ...prev, endsAt: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                If empty, it will remain visible until deactivated.
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <button
                onClick={handleSubmit}
                disabled={isFormPending}
                className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                <Megaphone className="w-5 h-5" />
                {editingId ? 'Update Announcement' : 'Publish Announcement'}
              </button>
              {editingId && (
                <button
                  onClick={resetForm}
                  disabled={isFormPending}
                  className="w-full py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <ConfirmDialog
        isOpen={pendingDeleteAnnouncementId !== null}
        title="Delete announcement?"
        description="This permanently removes the announcement from the dashboard."
        confirmLabel="Delete announcement"
        isConfirming={isRowPending && pendingDeleteAnnouncementId !== null}
        onConfirm={confirmDelete}
        onClose={() => setPendingDeleteAnnouncementId(null)}
      />

      <section className="bg-white dark:bg-gray-800 shadow-sm rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Announcement List
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Active: {activeCount} / Total: {announcements.length}
            </p>
          </div>
        </div>

        {announcements.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            No announcements registered.
          </div>
        ) : (
          <div className="space-y-4">
            {announcements.map((announcement) => {
              const severityStyle = severityStyles[announcement.severity] ?? severityStyles.info
              const isBusy = rowActionId === announcement.id && isRowPending
              return (
                <div
                  key={announcement.id}
                  className="p-5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${severityStyle.badge}`}
                      >
                        {severityLabels[announcement.severity]}
                      </span>
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded border ${
                          announcement.is_active
                            ? 'text-green-700 bg-green-50 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800'
                            : 'text-gray-500 bg-gray-100 border-gray-200 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-700'
                        }`}
                      >
                        {announcement.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(announcement)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Pencil className="w-4 h-4" />
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggle(announcement)}
                        disabled={isBusy}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md ${
                          announcement.is_active
                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200'
                            : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                        } disabled:opacity-50`}
                      >
                        {announcement.is_active ? (
                          <PauseCircle className="w-4 h-4" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        {announcement.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => handleDelete(announcement.id)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30 disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="text-gray-900 dark:text-gray-100 whitespace-pre-line mb-3">
                    {announcement.message}
                  </p>
                  <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    {announcement.cta_label && (
                      <p>
                        CTA: <strong>{announcement.cta_label}</strong>{' '}
                        {announcement.cta_url && (
                          <a
                            href={announcement.cta_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 dark:text-indigo-300 hover:underline"
                          >
                            {announcement.cta_url}
                          </a>
                        )}
                      </p>
                    )}
                    <p>
                      Start: {formatDate(announcement.starts_at)} | End:{' '}
                      {announcement.ends_at ? formatDate(announcement.ends_at) : 'Not set'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      Created {formatDate(announcement.created_at)} · Updated{' '}
                      {formatDate(announcement.updated_at)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
