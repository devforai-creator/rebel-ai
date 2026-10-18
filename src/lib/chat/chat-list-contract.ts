import { z } from 'zod'

export const CHAT_TITLE_MAX_LENGTH = 100
export const chatTitleSchema = z
  .string()
  .trim()
  .min(1, '제목을 입력해주세요.')
  .max(CHAT_TITLE_MAX_LENGTH, `제목은 ${CHAT_TITLE_MAX_LENGTH}자까지 입력할 수 있습니다.`)
  .refine((title) => !/[\r\n\t]/.test(title), '제목은 한 줄로 입력해주세요.')
