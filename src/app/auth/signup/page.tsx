import React from 'react'
import Link from 'next/link'

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <div className="max-w-md w-full space-y-8 bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Sign-up Closed</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            New accounts are not part of the current operating mode.
          </p>
        </div>

        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 px-4 py-4 rounded-lg space-y-3">
          <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-400 mb-2">
            New registrations are temporarily suspended
          </h3>
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            We are currently not accepting new sign-ups due to security enhancements and
            improvements. Existing users can continue to use the service.
          </p>
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            For personal or closed deployments, create the first account in Supabase Dashboard
            before signing in.
          </p>
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            The open source code is available on{' '}
            <a
              href="https://github.com/devforai-creator/RebelAI"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-yellow-900 dark:hover:text-yellow-100"
            >
              GitHub
            </a>
            .
          </p>
        </div>

        <div className="space-y-4">
          <div className="text-center text-sm">
            <span className="text-gray-600 dark:text-gray-400">Already have an account? </span>
            <Link
              href="/auth/login"
              className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
            >
              Sign In
            </Link>
          </div>

          <div className="text-center text-sm">
            <Link
              href="/"
              className="font-medium text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
