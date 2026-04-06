'use client'

import { useState } from 'react'
import GoogleApiKeySidePanel from './api-keys/GoogleApiKeySidePanel'

export default function QuickStartGuide() {
  const [isGuideOpen, setIsGuideOpen] = useState(false)

  return (
    <>
      <div className="mt-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-300 mb-3">
          Quick Start Guide
        </h3>
        <ol className="space-y-2 text-sm text-blue-800 dark:text-blue-300 mb-4">
          <li className="flex items-start">
            <span className="font-semibold mr-2">1.</span>
            <span>Register your API key</span>
          </li>
          <li className="flex items-start">
            <span className="font-semibold mr-2">2.</span>
            <span>Create your first character</span>
          </li>
          <li className="flex items-start">
            <span className="font-semibold mr-2">3.</span>
            <span>Start chatting with your character!</span>
          </li>
        </ol>
        <div className="pt-3 border-t border-blue-200 dark:border-blue-700">
          <button
            onClick={() => setIsGuideOpen(true)}
            className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 transition-colors"
          >
            <span></span>
            <span>View Google Gemini API Key Guide</span>
            <span></span>
          </button>
        </div>
      </div>

      <GoogleApiKeySidePanel isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </>
  )
}
