'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getFormDataErrorMessage, safeParseFormData } from '@/lib/form-data'
import { createClient } from '@/lib/supabase/server'

const loginFormSchema = z.object({
  email: z.string().min(1, 'Email is required.'),
  password: z.string().min(1, 'Password is required.'),
})

function parseLoginFormData(formData: FormData) {
  const parsed = safeParseFormData(formData, loginFormSchema)

  if (!parsed.success) {
    return {
      error: getLoginFormErrorMessage(parsed.error),
    }
  }

  return { data: parsed.data }
}

export async function login(formData: FormData) {
  const supabase = await createClient()

  const parsedForm = parseLoginFormData(formData)

  if ('error' in parsedForm) {
    return parsedForm
  }

  const data = parsedForm.data

  const { error } = await supabase.auth.signInWithPassword(data)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signup(_formData: FormData) {
  void _formData

  // Public signup stays intentionally closed in the current operating contract.
  return {
    error: '현재 신규 가입이 중단되었습니다. 기존 사용자는 계속 이용 가능합니다.',
  }
}

export async function logout() {
  const supabase = await createClient()

  const { error } = await supabase.auth.signOut()

  if (error) {
    console.error('Logout error:', error.message)
  }

  revalidatePath('/', 'layout')
  redirect('/auth/login')
}

function getLoginFormErrorMessage(error: z.ZodError): string {
  const firstIssue = error.issues[0]
  const field = typeof firstIssue?.path[0] === 'string' ? firstIssue.path[0] : null

  if (field === 'email') {
    return 'Email is required.'
  }

  if (field === 'password') {
    return 'Password is required.'
  }

  return getFormDataErrorMessage(error, 'Invalid login form submission.')
}
