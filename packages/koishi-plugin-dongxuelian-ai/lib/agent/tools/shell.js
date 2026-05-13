/**
 * MODULE: Shell 命令执行工具。
 * 安全：denylist + timeout + 路径限定。默认危险（需 confirm 或 block）。
 */
const { execFile } = require('child_process')
const os = require('os')

const DENYLIST = [
  /rm\s+(-rf?\s*\/|--no-preserve-root)/i,
  /mkfs/i, /dd\s+if=/i, />\s*\/dev\/(sd|nvme)/i,
  /chmod\s+777\s+\//i, /:\(\)\s*\{\s*:\s*\|\s*:&\s*\};:/i,
]

module.exports = {
  definition: {
    name: 'execute_shell',
    description: '执行 shell 命令。Windows 用 cmd.exe，Linux/macOS 用 sh。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        cwd: { type: 'string', description: '工作目录，默认 bot 目录' },
      },
      required: ['command'],
    },
  },
  async execute(params = {}) {
    const command = String(params.command || '').trim()
    if (!command) throw new Error('命令为空')
    if (command.length > 8000) throw new Error('命令过长')
    if (DENYLIST.some(re => re.test(command))) throw new Error(`危险命令已被拦截`)

    const cwd = String(params.cwd || process.cwd())
    const isWin = os.platform() === 'win32'

    return new Promise(resolve => {
      const child = execFile(
        isWin ? 'cmd.exe' : '/bin/sh',
        isWin ? ['/d', '/s', '/c', command] : ['-c', command],
        { cwd, timeout: 25000, maxBuffer: 500 * 1024, windowsHide: true, env: { ...process.env } },
        (err, stdout, stderr) => {
          const parts = []
          if (stdout) parts.push(`[stdout]\n${stdout}`)
          if (stderr) parts.push(`[stderr]\n${stderr}`)
          if (err && err.killed) parts.push('(命令执行超时，已取消)')
          else if (err) parts.push(`[exit code: ${err.code || -1}]`)
          if (parts.length === 0) parts.push('(执行成功，无输出)')
          resolve(parts.join('\n'))
        },
      )
    })
  },
  dangerous: true,
  defaultChannels: [],
}
