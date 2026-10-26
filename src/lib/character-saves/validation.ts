import { z } from 'zod'
import { MAX_SAVE_CONTENT_LENGTH, MAX_SAVE_TITLE_LENGTH } from './constants'

export const characterSaveInputSchema = z
  .object({
    title: z.string().trim().min(1, '세이브 제목을 입력해주세요').max(MAX_SAVE_TITLE_LENGTH),
    // Preserve the user's canon verbatim, including intentional line breaks.
    content: z.string().max(MAX_SAVE_CONTENT_LENGTH),
    characterId: z.uuid().nullable(),
    defaultPersonaId: z.uuid().nullable(),
  })
  .strict()

export type CharacterSaveInput = z.infer<typeof characterSaveInputSchema>
