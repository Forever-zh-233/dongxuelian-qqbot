<template>
  <section class="agent-panel panel-card">
    <div class="panel-head">
      <div>
        <h2>Agent 控制台</h2>
        <p>管理工具暴露范围、安全策略，并在 Dashboard 内测试 Agent。</p>
      </div>
      <button class="ghost" type="button" :disabled="loading" @click="loadConfig">刷新</button>
    </div>

    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="message" class="notice">{{ message }}</div>

    <div class="grid">
      <label class="field">
        <span>工具安全模式</span>
        <select v-model="mode">
          <option value="config">跟随配置</option>
          <option value="confirm">危险工具需确认</option>
          <option value="block">禁用危险工具</option>
          <option value="auto">自动执行</option>
        </select>
      </label>
      <label class="field">
        <span>危险工具策略</span>
        <select v-model="config.dangerousPolicy">
          <option value="confirm">需确认</option>
          <option value="block">禁用</option>
          <option value="auto">自动执行</option>
        </select>
      </label>
      <label class="switch-row">
        <input v-model="config.channels.qq.enabled" type="checkbox" />
        <span>QQ Agent</span>
      </label>
      <label class="switch-row">
        <input v-model="config.channels.dashboard.enabled" type="checkbox" />
        <span>Dashboard Agent</span>
      </label>
      <label class="switch-row">
        <input v-model="config.autoRoute.qq.enabled" type="checkbox" />
        <span>QQ 自动路由</span>
      </label>
    </div>

    <div class="section-head">
      <h3>工具开关</h3>
      <button class="primary" type="button" :disabled="saving" @click="saveConfig">保存配置</button>
    </div>
    <div class="tool-list">
      <div v-for="tool in tools" :key="tool.name" class="tool-row" :class="{ danger: tool.dangerous }">
        <div>
          <strong>{{ tool.name }}</strong>
          <p>{{ tool.description }}</p>
          <small>{{ tool.dangerous ? '危险工具' : '安全工具' }}</small>
        </div>
        <label><input v-model="config.channels.qq.tools[tool.name]" type="checkbox" /> QQ</label>
        <label><input v-model="config.channels.dashboard.tools[tool.name]" type="checkbox" /> Dashboard</label>
      </div>
    </div>

    <div class="section-head">
      <h3>文件读取根目录</h3>
      <button class="ghost" type="button" @click="addReadRoot">添加</button>
    </div>
    <div class="root-list">
      <div v-for="(root, index) in config.readFileRoots" :key="index" class="root-row">
        <input v-model="config.readFileRoots[index]" placeholder="留空则使用进程工作目录" />
        <button class="ghost" type="button" @click="removeReadRoot(index)">删除</button>
      </div>
      <p v-if="config.readFileRoots.length === 0" class="muted">未配置时默认限制在当前工作目录。</p>
    </div>

    <div class="section-head">
      <h3>Skill 索引</h3>
      <span class="muted">只读预览 {{ skills.length }} 个</span>
    </div>
    <div class="skill-list">
      <label v-for="skill in skills" :key="skill.file" class="skill-row">
        <input v-model="config.enabledSkills" type="checkbox" :value="skill.name" />
        <strong>{{ skill.name }}</strong>
        <span>{{ skill.kind }}</span>
        <p>{{ skill.description || '无描述' }}</p>
      </label>
    </div>

    <div class="section-head">
      <h3>Dashboard Agent 测试</h3>
      <span class="muted">累计调用 {{ stats.total || 0 }} 次 · QQ {{ stats.byChannel?.qq || 0 }} / Dashboard {{ stats.byChannel?.dashboard || 0 }}</span>
    </div>
    <div v-if="pendingTools.length" class="section-head">
      <h3>审批队列</h3>
      <span class="muted">{{ pendingTools.length }} 个待确认</span>
    </div>
    <div v-if="pendingTools.length" class="pending-list">
      <div v-for="item in pendingTools" :key="item.id" class="pending-row">
        <div>
          <strong>{{ item.toolName }}</strong>
          <p>{{ item.channelKey }} / {{ item.userId }} · {{ formatTime(item.expireAt) }} 过期</p>
          <small>{{ item.argsSummary || '无参数摘要' }}</small>
        </div>
        <button class="ghost" type="button" :disabled="sending" @click="confirmPendingTool(item.id)">确认</button>
      </div>
    </div>

    <div v-if="sessions.length" class="section-head">
      <h3>Agent Sessions</h3>
      <span class="muted">{{ sessions.length }} 个</span>
    </div>
    <div v-if="sessions.length" class="session-list">
      <div v-for="session in sessions" :key="session.id" class="session-row">
        <strong>{{ session.title }}</strong>
        <p>{{ session.channel }} / {{ session.userName }} · {{ session.turns }} 轮 · {{ session.toolCalls }} 次工具 · {{ formatTime(session.updatedAt) }}</p>
        <small>{{ session.lastMessage }}</small>
      </div>
    </div>

    <div v-if="stats.recent?.length" class="section-head">
      <h3>最近工具调用</h3>
      <span class="muted">{{ stats.recent.length }} 条</span>
    </div>
    <div v-if="stats.recent?.length" class="stats-list">
      <span v-for="item in stats.recent" :key="item.at + item.tool" class="stat-pill">{{ item.channel }} · {{ item.tool }}</span>
    </div>

    <div class="chat-box">
      <textarea v-model="prompt" placeholder="例如：读取 package.json 总结项目脚本" @keydown.ctrl.enter.prevent="sendMessage"></textarea>
      <div class="chat-actions">
        <button class="primary" type="button" :disabled="sending || !prompt.trim()" @click="sendMessage">发送</button>
        <button class="ghost" type="button" :disabled="sending || !pendingId" @click="confirmPendingTool">确认工具</button>
        <button class="ghost" type="button" :disabled="sending || history.length === 0" @click="clearHistory">清空</button>
      </div>
    </div>
    <div v-if="history.length" class="history-list">
      <div v-for="(item, index) in history" :key="index" class="history-item" :class="item.role">
        <strong>{{ item.role === 'user' ? '你' : 'Agent' }}</strong>
        <pre>{{ item.content }}</pre>
      </div>
    </div>
  </section>
</template>

<script>
import { onMounted, reactive, ref } from 'vue'
import { fetchAgentConfig, saveAgentConfig, sendAgentMessage, confirmAgentTool, fetchPendingAgentTools, fetchAgentSessions } from '../api'

const defaultConfig = {
  dangerousPolicy: 'confirm',
  channels: {
    qq: { enabled: true, tools: {} },
    dashboard: { enabled: true, tools: {} },
  },
  autoRoute: {
    qq: { enabled: true },
    dashboard: { enabled: false },
  },
  enabledSkills: [],
  readFileRoots: [],
}

export default {
  name: 'AgentPanel',
  setup() {
    const loading = ref(false)
    const saving = ref(false)
    const sending = ref(false)
    const error = ref('')
    const message = ref('')
    const mode = ref('config')
    const tools = ref([])
    const skills = ref([])
    const stats = ref({ total: 0 })
    const prompt = ref('')
    const pendingId = ref('')
    const pendingTools = ref([])
    const sessions = ref([])
    const history = ref([])
    const config = reactive(JSON.parse(JSON.stringify(defaultConfig)))

    function applyConfig(next) {
      const merged = JSON.parse(JSON.stringify({ ...defaultConfig, ...(next || {}) }))
      config.dangerousPolicy = merged.dangerousPolicy || 'confirm'
      config.readFileRoots = Array.isArray(merged.readFileRoots) ? merged.readFileRoots : []
      for (const channel of ['qq', 'dashboard']) {
        config.channels[channel].enabled = !!merged.channels?.[channel]?.enabled
        config.channels[channel].tools = { ...(merged.channels?.[channel]?.tools || {}) }
        config.autoRoute[channel].enabled = !!merged.autoRoute?.[channel]?.enabled
      }
      config.enabledSkills = Array.isArray(merged.enabledSkills) ? merged.enabledSkills.slice() : []
    }

    function formatTime(ts) {
      if (!ts) return '-'
      try { return new Date(ts).toLocaleTimeString() } catch { return '-' }
    }

    async function loadPendingTools() {
      try {
        const res = await fetchPendingAgentTools()
        if (res.ok && res.data?.ok) {
          pendingTools.value = Array.isArray(res.data.pending) ? res.data.pending : []
          pendingId.value = pendingTools.value[0]?.id || ''
        }
      } catch {}
    }

    async function loadSessions() {
      try {
        const res = await fetchAgentSessions()
        if (res.ok && res.data?.ok) sessions.value = Array.isArray(res.data.sessions) ? res.data.sessions : []
      } catch {}
    }

    async function loadConfig() {
      loading.value = true
      error.value = ''
      try {
        const res = await fetchAgentConfig()
        if (!res.ok || !res.data?.ok) throw new Error(res.data?.message || '加载失败')
        applyConfig(res.data.config)
        mode.value = res.data.mode || 'config'
        tools.value = res.data.tools || []
        stats.value = res.data.stats || { total: 0 }
        skills.value = res.data.skills || []
        for (const tool of tools.value) {
          if (config.channels.qq.tools[tool.name] === undefined) config.channels.qq.tools[tool.name] = !!tool.qqEnabled
          if (config.channels.dashboard.tools[tool.name] === undefined) config.channels.dashboard.tools[tool.name] = !!tool.dashboardEnabled
        }
        await loadPendingTools()
        await loadSessions()
      } catch (e) {
        error.value = e.message || '加载失败'
      } finally {
        loading.value = false
      }
    }

    async function saveConfig() {
      saving.value = true
      error.value = ''
      message.value = ''
      try {
        const res = await saveAgentConfig({ config: JSON.parse(JSON.stringify(config)), mode: mode.value })
        if (!res.ok || !res.data?.ok) throw new Error(res.data?.message || '保存失败')
        applyConfig(res.data.config)
        mode.value = res.data.mode || mode.value
        message.value = res.data.message || '已保存'
      } catch (e) {
        error.value = e.message || '保存失败'
      } finally {
        saving.value = false
      }
    }

    function addReadRoot() {
      config.readFileRoots.push('')
    }

    function removeReadRoot(index) {
      config.readFileRoots.splice(index, 1)
    }

    function loadHistory() {
      try {
        const saved = JSON.parse(localStorage.getItem('dashboard_agent_history') || '[]')
        history.value = Array.isArray(saved) ? saved.filter(item => item && ['user', 'assistant'].includes(item.role)).slice(-30) : []
      } catch {
        history.value = []
      }
    }

    function clearHistory() {
      history.value = []
      localStorage.removeItem('dashboard_agent_history')
    }

    async function confirmPendingTool(targetId = pendingId.value) {
      if (!targetId) return
      sending.value = true
      error.value = ''
      try {
        const res = await confirmAgentTool(targetId)
        if (!res.ok || !res.data?.ok) throw new Error(res.data?.message || '确认失败')
        const content = `已执行 ${res.data.toolName}：\n${res.data.result || ''}`
        history.value.push({ role: 'assistant', content })
        history.value = history.value.slice(-30)
        localStorage.setItem('dashboard_agent_history', JSON.stringify(history.value))
        pendingId.value = ''
        await loadConfig()
      } catch (e) {
        error.value = e.message || '确认失败'
      } finally {
        sending.value = false
      }
    }

    async function sendMessage() {
      const text = prompt.value.trim()
      if (!text) return
      sending.value = true
      error.value = ''
      const recentHistory = history.value.slice(-10)
      history.value.push({ role: 'user', content: text })
      prompt.value = ''
      try {
        const res = await sendAgentMessage(text, recentHistory)
        if (!res.ok || !res.data?.ok) throw new Error(res.data?.message || '发送失败')
        history.value.push({ role: 'assistant', content: res.data.reply || '(无回复)' })
        pendingId.value = res.data.pendingId || ''
        history.value = history.value.slice(-30)
        localStorage.setItem('dashboard_agent_history', JSON.stringify(history.value))
        await loadConfig()
      } catch (e) {
        history.value.push({ role: 'assistant', content: e.message || '发送失败' })
        error.value = e.message || '发送失败'
      } finally {
        sending.value = false
      }
    }

    onMounted(() => { loadHistory(); loadConfig() })
    return { loading, saving, sending, error, message, mode, tools, skills, stats, prompt, pendingId, pendingTools, sessions, history, config, formatTime, loadConfig, saveConfig, addReadRoot, removeReadRoot, clearHistory, confirmPendingTool, sendMessage }
  },
}
</script>

<style scoped>
.agent-panel { display: flex; flex-direction: column; gap: 16px; }
.panel-head, .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2, h3, p { margin: 0; }
.panel-head p, .tool-row p, .muted { color: var(--text3); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.field, .switch-row { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: color-mix(in srgb, var(--card) 70%, transparent); }
.switch-row { flex-direction: row; align-items: center; }
select, textarea { width: 100%; border: 1px solid var(--border); border-radius: 10px; background: var(--input); color: var(--text); padding: 10px; }
textarea { min-height: 110px; resize: vertical; }
.tool-list, .skill-list { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.tool-row { display: grid; grid-template-columns: minmax(0, 1fr) 110px 130px; gap: 12px; align-items: center; padding: 12px; border-bottom: 1px solid var(--border); }
.tool-row:last-child, .skill-row:last-child { border-bottom: 0; }
.skill-row { display: grid; grid-template-columns: 24px minmax(120px, .5fr) 90px minmax(0, 1fr); gap: 12px; align-items: center; padding: 12px; border-bottom: 1px solid var(--border); }
.skill-row p { margin: 0; color: var(--text3); }
.tool-row.danger { background: color-mix(in srgb, #ef4444 8%, transparent); }
.tool-row small { color: var(--text3); }
.chat-box { display: grid; grid-template-columns: minmax(0, 1fr) 110px; gap: 12px; align-items: stretch; }
.root-list { display: flex; flex-direction: column; gap: 8px; }
.root-row { display: grid; grid-template-columns: minmax(0, 1fr) 90px; gap: 8px; }
.root-row input { width: 100%; border: 1px solid var(--border); border-radius: 10px; background: var(--input); color: var(--text); padding: 10px; }
.history-list { display: flex; flex-direction: column; gap: 10px; }
.history-item { border: 1px solid var(--border); border-radius: 14px; padding: 12px; background: color-mix(in srgb, var(--input) 65%, transparent); }
.history-item.user { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.history-item pre { white-space: pre-wrap; margin: 6px 0 0; color: var(--text); font-family: inherit; }
.pending-list, .session-list { display: flex; flex-direction: column; gap: 8px; }
.pending-row, .session-row { display: grid; grid-template-columns: minmax(0, 1fr) 90px; gap: 10px; align-items: center; border: 1px solid var(--border); border-radius: 12px; padding: 10px; background: color-mix(in srgb, var(--input) 65%, transparent); }
.session-row { grid-template-columns: 1fr; }
.pending-row p, .session-row p, .session-row small { margin: 4px 0 0; color: var(--text3); }
.stats-list { display: flex; flex-wrap: wrap; gap: 8px; }
.stat-pill { border: 1px solid var(--border); border-radius: 999px; padding: 6px 10px; color: var(--text3); background: color-mix(in srgb, var(--input) 70%, transparent); }
.chat-actions { display: flex; flex-direction: column; gap: 8px; }
.notice { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border)); border-radius: 12px; color: var(--text); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.notice.error { border-color: color-mix(in srgb, #ef4444 55%, var(--border)); background: color-mix(in srgb, #ef4444 12%, transparent); }
.primary, .ghost { border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; color: var(--text); background: var(--input); cursor: pointer; }
.primary { background: color-mix(in srgb, var(--accent) 24%, var(--input)); }
button:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 760px) {
  .panel-head, .section-head, .chat-box, .root-row { grid-template-columns: 1fr; display: grid; }
  .tool-row, .skill-row { grid-template-columns: 1fr; }
}
</style>
