'use client'

import { useState } from 'react'
import CharacterForm from '../CharacterForm'
import CharacterImport from '../CharacterImport'

type TabType = 'manual' | 'import'

export default function NewCharacterTabs() {
  const [activeTab, setActiveTab] = useState<TabType>('manual')

  return (
    <div>
      {/* Tab Navigation */}
      <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('manual')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'manual'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            수동 생성
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'import'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            캐릭터 가져오기
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'manual' && <CharacterForm showResourceSelectors={false} />}
        {activeTab === 'import' && <CharacterImport />}
      </div>
    </div>
  )
}
