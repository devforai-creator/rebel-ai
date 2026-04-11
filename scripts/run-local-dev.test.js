import { describe, expect, it, vi } from 'vitest'
import localDev from './run-local-dev.js'

const { LOCALHOST_ORIGIN, createLocalDevEnv, createNextDevCommand, runLocalDev } = localDev

describe('run-local-dev', () => {
  it('forces localhost INTERNAL_API_ORIGIN without mutating other env keys', () => {
    const env = {
      CHAT_ADMIN_SECRET: 'secret',
      INTERNAL_API_ORIGIN: 'https://rebel-chat.vercel.app',
    }

    expect(createLocalDevEnv(env)).toEqual({
      CHAT_ADMIN_SECRET: 'secret',
      INTERNAL_API_ORIGIN: LOCALHOST_ORIGIN,
    })
  })

  it('builds the next dev command and forwards extra args', () => {
    const command = createNextDevCommand(['--hostname', '127.0.0.1'])

    expect(command.command).toBe(process.execPath)
    expect(command.args[0]).toContain('next/dist/bin/next')
    expect(command.args.slice(1)).toEqual(['dev', '--hostname', '127.0.0.1'])
  })

  it('spawns next dev with inherited stdio and localhost origin override', () => {
    const child = {
      on: vi.fn(),
    }
    const spawnImpl = vi.fn(() => child)
    const env = {
      CHAT_ADMIN_SECRET: 'secret',
      INTERNAL_API_ORIGIN: 'https://rebel-chat.vercel.app',
    }

    const result = runLocalDev({
      argv: ['--hostname', '127.0.0.1'],
      env,
      spawnImpl,
    })

    expect(spawnImpl).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1'],
      {
        stdio: 'inherit',
        env: {
          CHAT_ADMIN_SECRET: 'secret',
          INTERNAL_API_ORIGIN: LOCALHOST_ORIGIN,
        },
      },
    )
    expect(child.on).toHaveBeenCalledTimes(2)
    expect(result).toBe(child)
  })
})
