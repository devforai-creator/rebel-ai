import type { Metadata } from 'next'
import { connection } from 'next/server'
import { Toaster } from 'sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'RebelAI',
  description: 'BYOK AI character chat platform with long-term memory',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Per-request CSP nonces require every document route to render with an incoming request.
  await connection()

  return (
    <html lang="ko">
      <body className="antialiased">
        {children}
        <Toaster position="top-center" richColors closeButton duration={5000} />
      </body>
    </html>
  )
}
