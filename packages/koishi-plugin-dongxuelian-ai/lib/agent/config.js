/**
 * MODULE: Agent 工具配置。
 * 职责: 读写工具开关、按渠道暴露策略、工作区根目录。
 * 边界: 不执行工具、不调用 AI API。
 * 状态: configCache (object|null)。
 */
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { TOOL_CONFIG_FILE } = require('../constants')

const KNOWN_CHANNELS = new Set(['qq', 'dashboard'])
const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  channels: {
    qq: {
      enabled: true,
      tools: {
        get_current_time: true,
        calculate: true,
        web_search: false,
        read_file: false,
        list_files: false,
        find_files: false,
        write_file: false,
        edit_file: false,
        execute_shell: false,
        browser_action: false,
      },
    },
    dashboard: {
      enabled: true,
      tools: {
        get_current_time: true,
        calculate: true,
        web_search: true,
        read_file: true,
        list_files: true,
        find_files: true,
        write_file: true,
        edit_file: true,
        execute_shell: false,
        browser_action: false,
      },
    },
  },
  dangerousPolicy: 'confirm',
  autoRoute: {
    qq: { enabled: false },
    dashboard: { enabled: false },
  },
  enabledSkills: [],
  readFileRoots: [],
})

let configCache = null

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeToolMap(value, defaults) {
  const result = { ...defaults }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [name, enabled] of Object.entries(value)) {
    result[name] = !!enabled
  }
  return result
}

function normalizeChannelConfig(value, defaults) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    enabled: src.enabled === undefined ? defaults.enabled : !!src.enabled,
    tools: normalizeToolMap(src.tools, defaults.tools),
  }
}

function normalizeRoot(root) {
  const value = String(root || '').trim()
  if (!value) return ''
  return path.resolve(value)
}

function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const defaults = clone(DEFAULT_CONFIG)
  const channels = {}
  for (const channel of KNOWN_CHANNELS) {
    channels[channel] = normalizeChannelConfig(source.channels && source.channels[channel], defaults.channels[channel])
  }
  const dangerousPolicy = ['auto', 'confirm', 'block'].includes(source.dangerousPolicy) ? source.dangerousPolicy : defaults.dangerousPolicy
  const readFileRoots = Array.isArray(source.readFileRoots)
    ? source.readFileRoots.map(normalizeRoot).filter(Boolean).slice(0, 16)
    : defaults.readFileRoots
  const autoRoute = {
    qq: { enabled: source.autoRoute?.qq?.enabled === undefined ? defaults.autoRoute.qq.enabled : !!source.autoRoute.qq.enabled },
    dashboard: { enabled: source.autoRoute?.dashboard?.enabled === undefined ? defaults.autoRoute.dashboard.enabled : !!source.autoRoute.dashboard.enabled },
  }
  const enabledSkills = Array.isArray(source.enabledSkills)
    ? source.enabledSkills.map(item => String(item || '').trim()).filter(Boolean).slice(0, 32)
    : defaults.enabledSkills
  return { version: 1, channels, dangerousPolicy, autoRoute, enabledSkills, readFileRoots }
}

function readConfigFile() {
  try {
    const text = fs.readFileSync(TOOL_CONFIG_FILE, 'utf8').replace(/^﻿/, '')
    return JSON.parse(text)
  } catch {
    return null
  }
}

function getAgentConfig(force = false) {
  if (!force && configCache) return clone(configCache)
  configCache = normalizeConfig(readConfigFile() || DEFAULT_CONFIG)
  return clone(configCache)
}

async function saveAgentConfig(nextConfig) {
  const normalized = normalizeConfig(nextConfig)
  await fsp.mkdir(path.dirname(TOOL_CONFIG_FILE), { recursive: true })
  await fsp.writeFile(TOOL_CONFIG_FILE, JSON.stringify(normalized, null, 2), 'utf8')
  configCache = normalized
  return clone(normalized)
}

async function patchAgentConfig(patch = {}) {
  const current = getAgentConfig()
  const merged = {
    ...current,
    ...patch,
    channels: {
      ...current.channels,
      ...(patch.channels || {}),
    },
  }
  return saveAgentConfig(merged)
}

async function setChannelEnabled(channel, enabled) {
  if (!KNOWN_CHANNELS.has(channel)) throw new Error(`未知渠道：${channel}`)
  const current = getAgentConfig()
  current.channels[channel].enabled = !!enabled
  return saveAgentConfig(current)
}

async function setToolEnabled(channel, toolName, enabled) {
  if (!KNOWN_CHANNELS.has(channel)) throw new Error(`未知渠道：${channel}`)
  const current = getAgentConfig()
  current.channels[channel].tools[String(toolName)] = !!enabled
  return saveAgentConfig(current)
}

function isChannelEnabled(channel) {
  const config = getAgentConfig()
  return !!(config.channels[channel] && config.channels[channel].enabled)
}

function isToolEnabled(channel, toolName) {
  const config = getAgentConfig()
  const channelConfig = config.channels[channel]
  if (!channelConfig || !channelConfig.enabled) return false
  return !!channelConfig.tools[toolName]
}

function getReadFileRoots() {
  return getAgentConfig().readFileRoots.map(normalizeRoot).filter(Boolean)
}

function getDangerousPolicy() {
  return getAgentConfig().dangerousPolicy
}

function isAutoRouteEnabled(channel = 'qq') {
  const config = getAgentConfig()
  return !!(config.autoRoute && config.autoRoute[channel] && config.autoRoute[channel].enabled)
}

function getEnabledSkills() {
  return getAgentConfig().enabledSkills.slice()
}

function resetAgentConfigCache() {
  configCache = null
}

module.exports = {
  DEFAULT_CONFIG,
  getAgentConfig,
  saveAgentConfig,
  patchAgentConfig,
  setChannelEnabled,
  setToolEnabled,
  isChannelEnabled,
  isToolEnabled,
  getReadFileRoots,
  getDangerousPolicy,
  isAutoRouteEnabled,
  getEnabledSkills,
  resetAgentConfigCache,
}
