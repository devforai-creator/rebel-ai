'use client'

import React, { useState } from 'react'
import Button from '@/app/dashboard/components/Button'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import { changePassword } from './actions'

export default function ChangePasswordForm() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const newPassword = formData.get('new_password') as string
    const confirmPassword = formData.get('confirm_password') as string

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      setLoading(false)
      return
    }

    const result = await changePassword(formData)

    if (result?.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)

    // Reset form
    e.currentTarget.reset()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <InlineFeedback tone="error">{error}</InlineFeedback>}

      {success && <InlineFeedback tone="success">Password changed successfully.</InlineFeedback>}

      <div>
        <label
          htmlFor="new_password"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
        >
          New Password
        </label>
        <input
          type="password"
          id="new_password"
          name="new_password"
          required
          minLength={6}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          placeholder="Minimum 6 characters"
        />
      </div>

      <div>
        <label
          htmlFor="confirm_password"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
        >
          Confirm Password
        </label>
        <input
          type="password"
          id="confirm_password"
          name="confirm_password"
          required
          minLength={6}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          placeholder="Re-enter password"
        />
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? 'Changing...' : 'Change Password'}
      </Button>
    </form>
  )
}
