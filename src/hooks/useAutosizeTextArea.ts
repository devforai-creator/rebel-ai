import { useLayoutEffect, type RefObject } from 'react'

interface Options {
  minHeight?: number
  maxHeight?: number
}

export function useAutosizeTextArea(
  textAreaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  { minHeight = 0, maxHeight }: Options = {},
) {
  useLayoutEffect(() => {
    const element = textAreaRef.current
    if (!element) return

    element.style.height = 'auto'
    const scrollHeight = element.scrollHeight
    const boundedHeight =
      typeof maxHeight === 'number' ? Math.min(scrollHeight, maxHeight) : scrollHeight
    const finalHeight = Math.max(boundedHeight, minHeight)

    element.style.height = `${finalHeight}px`
  }, [textAreaRef, value, minHeight, maxHeight])
}
