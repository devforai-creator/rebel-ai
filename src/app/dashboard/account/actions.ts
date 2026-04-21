'use server'

import {
  changePassword as changePasswordImpl,
  deleteAccount as deleteAccountImpl,
} from './account-security-actions'
import {
  updateAgenticTranscriptRecallDefaultSettings as updateAgenticTranscriptRecallDefaultSettingsImpl,
  updateChatUsageSettings as updateChatUsageSettingsImpl,
  updateRagSettings as updateRagSettingsImpl,
  updateReprocessSettings as updateReprocessSettingsImpl,
  updateSummaryModelPreference as updateSummaryModelPreferenceImpl,
  updateSummaryPrompts as updateSummaryPromptsImpl,
  updateTranslationModelPreference as updateTranslationModelPreferenceImpl,
  type AgenticTranscriptRecallDefaultSettingsState,
  type ChatUsageSettingsState,
  type RagSettingsState,
  type ReprocessSettingsState,
  type SummaryModelPreferenceState,
  type TranslationModelPreferenceState,
} from './account-settings-actions'

export type {
  AgenticTranscriptRecallDefaultSettingsState,
  ChatUsageSettingsState,
  RagSettingsState,
  ReprocessSettingsState,
  SummaryModelPreferenceState,
  TranslationModelPreferenceState,
}

export async function updateSummaryPrompts(
  chunkPrompt: string | null,
  metaPrompt: string | null,
  factPrompt: string | null,
) {
  return updateSummaryPromptsImpl(chunkPrompt, metaPrompt, factPrompt)
}

export async function updateRagSettings(prevState: RagSettingsState, formData: FormData) {
  return updateRagSettingsImpl(prevState, formData)
}

export async function updateChatUsageSettings(
  prevState: ChatUsageSettingsState,
  formData: FormData,
) {
  return updateChatUsageSettingsImpl(prevState, formData)
}

export async function updateAgenticTranscriptRecallDefaultSettings(
  prevState: AgenticTranscriptRecallDefaultSettingsState,
  formData: FormData,
) {
  return updateAgenticTranscriptRecallDefaultSettingsImpl(prevState, formData)
}

export async function updateSummaryModelPreference(
  prevState: SummaryModelPreferenceState,
  formData: FormData,
) {
  return updateSummaryModelPreferenceImpl(prevState, formData)
}

export async function updateReprocessSettings(
  prevState: ReprocessSettingsState,
  formData: FormData,
) {
  return updateReprocessSettingsImpl(prevState, formData)
}

export async function updateTranslationModelPreference(
  prevState: TranslationModelPreferenceState,
  formData: FormData,
) {
  return updateTranslationModelPreferenceImpl(prevState, formData)
}

export async function deleteAccount() {
  return deleteAccountImpl()
}

export async function changePassword(formData: FormData) {
  return changePasswordImpl(formData)
}
