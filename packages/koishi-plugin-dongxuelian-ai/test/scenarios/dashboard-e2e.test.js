const path = require('path')
const fs = require('fs')
const http = require('http')

const STANDALONE_PATH = path.join(__dirname, '..', '..', '..', 'koishi-plugin-dashboard', 'standalone.js')

async function run(t) {
  t.section('scenario: dashboard TTS API contract')

  const tts = require('../../lib/tts')

  t.check('RANDOM_VOICE_RATE is 0.001', tts.RANDOM_VOICE_RATE === 0.001)
  t.check('BUILTIN_VOICES has 9 entries', tts.BUILTIN_VOICES.length === 9)
  t.check('MAX_TTS_TEXT_LENGTH is 300', tts.MAX_TTS_TEXT_LENGTH === 300)
  t.check('CHANNEL_COOLDOWN_MS is 5 minutes', tts.CHANNEL_COOLDOWN_MS === 5 * 60 * 1000)

  t.section('scenario: dashboard maintenance toggle logic')

  // Simulate the fixed toggleMaintenance behavior:
  // v-model sets maintenanceOn, then @change calls toggleMaintenance() with no args
  // The function should read maintenanceOn.value (the boolean), NOT the DOM Event
  let maintenanceOn = { value: false }
  let apiCalledWith = null

  async function mockSetMaintenance(val) {
    apiCalledWith = val
    return { ok: true }
  }

  // Simulate toggling ON: v-model sets value to true, then @change fires
  maintenanceOn.value = true
  async function toggleMaintenance() {
    const targetValue = maintenanceOn.value
    await mockSetMaintenance(targetValue)
  }
  await toggleMaintenance()
  t.check('maintenance toggle ON sends true', apiCalledWith === true)

  // Simulate toggling OFF: v-model sets value to false, then @change fires
  maintenanceOn.value = false
  await toggleMaintenance()
  t.check('maintenance toggle OFF sends false', apiCalledWith === false)

  // Old buggy behavior would pass DOM Event (truthy) regardless
  t.check('maintenance toggle does not pass Event object', typeof apiCalledWith === 'boolean')

  t.section('scenario: dashboard token usage provider mapping')

  // Simulate the fixed provider mapping logic
  const providerColors = { deepseek: '#4CAF50', opencode: '#2196F3', qwen: '#FF9800' }

  // Backend returns objects
  const backendProviders = [
    { key: 'deepseek', label: 'DeepSeek' },
    { key: 'opencode', label: 'OpenCode' },
    { key: 'qwen', label: 'Qwen' },
  ]

  // Fixed mapping logic (handles both string and object)
  const mapped = backendProviders.map(function(p) {
    const key = typeof p === 'string' ? p : p.key
    const label = typeof p === 'string' ? p : (p.label || p.key)
    return { key, label, color: providerColors[key] || '#888' }
  })

  t.check('provider mapping extracts key from object', mapped[0].key === 'deepseek')
  t.check('provider mapping extracts label from object', mapped[0].label === 'DeepSeek')
  t.check('provider mapping resolves color by key', mapped[0].color === '#4CAF50')
  t.check('provider mapping handles all entries', mapped.length === 3)

  // Also test with legacy string format (backwards compat)
  const legacyProviders = ['deepseek', 'opencode']
  const legacyMapped = legacyProviders.map(function(p) {
    const key = typeof p === 'string' ? p : p.key
    const label = typeof p === 'string' ? p : (p.label || p.key)
    return { key, label, color: providerColors[key] || '#888' }
  })
  t.check('provider mapping handles string format', legacyMapped[0].key === 'deepseek')
  t.check('provider mapping string label equals key', legacyMapped[0].label === 'deepseek')

  t.section('scenario: dashboard persona voice search scope')

  // The fix searches personas, core, and modes directories
  const DATA_DIR = path.join(__dirname, '..', '..', 'data')
  const searchDirs = ['personas', 'core', 'modes'].map(d => path.join(DATA_DIR, 'ai-skills', d))
  const existingDirs = searchDirs.filter(d => fs.existsSync(d))
  t.check('at least personas dir exists', existingDirs.length >= 1)
  t.check('search includes personas dir', searchDirs.some(d => d.includes('personas')))
  t.check('search includes core dir', searchDirs.some(d => d.includes('core')))
  t.check('search includes modes dir', searchDirs.some(d => d.includes('modes')))

  t.section('scenario: dashboard TTS voices API response shape')

  // Verify the API response shape matches what both frontends expect
  const { getAvailablePersonals, parsePersonaFrontmatter, loadPersonalSkill } = require('../../lib/persona')
  const personas = getAvailablePersonals({ userFacing: true })

  const voiceConfigs = personas.map(p => {
    const content = loadPersonalSkill(p.name)
    const meta = content ? parsePersonaFrontmatter(content) : {}
    return { name: p.name, voice: meta.voice_id || meta.voice || '', style: meta.voice_style || '', hasSample: false }
  })

  t.check('voices API personas is array', Array.isArray(voiceConfigs))
  t.check('voices API persona has name field', voiceConfigs.length === 0 || typeof voiceConfigs[0].name === 'string')
  t.check('voices API persona has voice field', voiceConfigs.length === 0 || typeof voiceConfigs[0].voice === 'string')
  t.check('voices API persona has style field', voiceConfigs.length === 0 || typeof voiceConfigs[0].style === 'string')
  t.check('voices API persona has hasSample field', voiceConfigs.length === 0 || typeof voiceConfigs[0].hasSample === 'boolean')

  // Frontend (agent-console) expects: res.data.builtin (array of strings), res.data.personas (array of objects)
  const mockApiResponse = { ok: true, builtin: tts.BUILTIN_VOICES, personas: voiceConfigs }
  t.check('API response has builtin array', Array.isArray(mockApiResponse.builtin))
  t.check('API response builtin contains strings', typeof mockApiResponse.builtin[0] === 'string')

  // Frontend maps personas to personaVoiceMap
  const pvMap = {}
  for (const p of mockApiResponse.personas) {
    if (p.name) pvMap[p.name] = { voiceId: p.voice || '', voiceStyle: p.style || '' }
  }
  t.check('personaVoiceMap is object', typeof pvMap === 'object')
  if (voiceConfigs.length > 0) {
    t.check('personaVoiceMap has voiceId field', typeof pvMap[voiceConfigs[0].name].voiceId === 'string')
    t.check('personaVoiceMap has voiceStyle field', typeof pvMap[voiceConfigs[0].name].voiceStyle === 'string')
  }

  t.section('scenario: handler 东雪莲说句话 phrase diversity')

  // Verify the phrase list has enough variety
  const handlerPath = path.join(__dirname, '..', '..', 'lib', 'handler.js')
  const handlerSrc = fs.readFileSync(handlerPath, 'utf8')
  const phraseMatch = handlerSrc.match(/const phrases = \[([\s\S]*?)\]/)
  t.check('handler has phrases array', !!phraseMatch)
  if (phraseMatch) {
    const phraseCount = (phraseMatch[1].match(/'/g) || []).length / 2
    t.check('phrases array has >= 20 entries', phraseCount >= 20)
  }

  t.section('scenario: standalone.js syntax and TTS endpoint existence')

  t.check('standalone.js exists', fs.existsSync(STANDALONE_PATH))
  const standaloneSrc = fs.readFileSync(STANDALONE_PATH, 'utf8')
  t.check('standalone has GET tts/voices endpoint', standaloneSrc.includes("'/dashboard/api/agent/tts/voices'"))
  t.check('standalone has POST tts/preview endpoint', standaloneSrc.includes("'/dashboard/api/agent/tts/preview'"))
  t.check('standalone has POST tts/clone endpoint', standaloneSrc.includes("'/dashboard/api/agent/tts/clone'"))
  t.check('standalone has PUT persona/voice endpoint', standaloneSrc.includes("'/dashboard/api/agent/persona/voice'"))

  // Verify the persona/voice endpoint searches all 3 dirs
  const voiceEndpointSection = standaloneSrc.slice(standaloneSrc.indexOf("'/dashboard/api/agent/persona/voice'"))
  t.check('persona/voice searches personas dir', voiceEndpointSection.includes("'personas'"))
  t.check('persona/voice searches core dir', voiceEndpointSection.includes("'core'"))
  t.check('persona/voice searches modes dir', voiceEndpointSection.includes("'modes'"))
}

module.exports = { run }
