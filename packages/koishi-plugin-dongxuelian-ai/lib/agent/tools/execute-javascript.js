/**
 * MODULE: 受限 JavaScript 执行工具。
 * 安全：用于数据处理，禁止 Node/文件/进程能力，超时执行。
 */
const vm = require('vm')

const BLOCKED = /\b(?:require|import|process|child_process|fs|global|globalThis|__dirname|__filename|module|exports|Function|eval)\b/
const MAX_CODE_CHARS = 12000

module.exports = {
  definition: {
    name: 'execute_javascript',
    description: '在受限沙箱中执行短 JavaScript 片段做数据处理。禁止文件、进程、网络和模块加载。',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要执行的 JavaScript 表达式或脚本，最后一行作为结果' },
      },
      required: ['code'],
    },
  },
  async execute(params = {}) {
    const code = String(params.code || '')
    if (!code.trim()) throw new Error('code 不能为空')
    if (code.length > MAX_CODE_CHARS) throw new Error(`代码过长：${code.length} 字符，最大 ${MAX_CODE_CHARS}`)
    if (BLOCKED.test(code)) throw new Error('代码包含被禁止的 Node/进程/模块能力')
    const sandbox = Object.freeze({ Math, JSON, Date, Number, String, Boolean, Array, Object, RegExp })
    const context = vm.createContext({ ...sandbox })
    const script = new vm.Script(`'use strict';\n${code}`)
    const result = script.runInContext(context, { timeout: 10000 })
    return JSON.stringify(result === undefined ? null : result, null, 2)
  },
  dangerous: true,
  defaultChannels: ['dashboard'],
}
