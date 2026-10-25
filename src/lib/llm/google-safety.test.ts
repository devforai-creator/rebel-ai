import { describe, expect, it, vi } from 'vitest'
import { createGoogleSafetySettingsFetch } from './google-safety'

const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent'

describe('Google safety request transport', () => {
  it('adds the jailbreak setting when no safety settings were supplied', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}))
    const signal = new AbortController().signal
    const init = { body: JSON.stringify({ contents: [] }), headers: { test: 'value' }, signal }
    await createGoogleSafetySettingsFetch(fetchImpl)(url, init)

    const [input, sent] = fetchImpl.mock.calls[0]
    expect(input).toBe(url)
    expect(sent?.headers).toBe(init.headers)
    expect(sent?.signal).toBe(signal)
    expect(JSON.parse(sent?.body as string)).toEqual({
      contents: [],
      safetySettings: [{ category: 'HARM_CATEGORY_JAILBREAK', threshold: 'OFF' }],
    })
  })

  it('keeps one explicit jailbreak OFF setting when a transport already supplies it', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}))
    await createGoogleSafetySettingsFetch(fetchImpl)(url, {
      body: JSON.stringify({
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
          { category: 'HARM_CATEGORY_JAILBREAK', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_JAILBREAK', threshold: 'OFF' },
        ],
      }),
    })

    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string).safetySettings).toEqual([
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_JAILBREAK', threshold: 'OFF' },
    ])
  })

  it.each([undefined, '', 'not json', 'null', '[]'])(
    'passes through non-object body %s',
    async (body) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}))
      const init = { body }
      await createGoogleSafetySettingsFetch(fetchImpl)(url, init)
      expect(fetchImpl).toHaveBeenCalledWith(url, init)
    },
  )

  it('propagates fetch failures without sending a second request', async () => {
    const failure = new Error('network unavailable')
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(failure)
    await expect(createGoogleSafetySettingsFetch(fetchImpl)(url, { body: '{}' })).rejects.toBe(
      failure,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
