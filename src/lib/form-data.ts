import { z } from 'zod'

export function safeParseFormData<TSchema extends z.ZodTypeAny>(
  formData: FormData,
  schema: TSchema,
) {
  return schema.safeParse(Object.fromEntries(formData.entries()))
}

export function getFormDataErrorMessage(
  error: z.ZodError,
  fallback = 'Invalid form submission.',
): string {
  return error.issues[0]?.message ?? fallback
}
