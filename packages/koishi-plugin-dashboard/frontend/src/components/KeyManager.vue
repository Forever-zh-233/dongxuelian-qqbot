<template>
  <div class="card">
    <h2>API Key 管理</h2>
    <div style="color:var(--text3);font-size:13px;margin-bottom:16px">
      修改后自动热加载，无需重启
    </div>
    <div v-for="k in keys" :key="k.file" class="grp">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div class="grp-name">{{ k.label }}</div>
          <div style="font-size:12px;color:var(--text3);font-family:monospace">{{ k.exists ? k.prefix : '（未设置）' }}</div>
        </div>
        <button class="btn btn-sm" @click="editKey(k)">编辑</button>
      </div>
    </div>

    <div v-if="editing" class="msg ok" style="margin-top:16px">
      <div style="margin-bottom:8px;font-weight:700">编辑 {{ editing.label }}</div>
      <input v-model="editValue" style="width:100%;font-family:monospace" :placeholder="'输入新的 ' + editing.file" />
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-sm" @click="saveKey" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
        <button class="btn btn-sm" style="background:var(--border);color:var(--text2)" @click="editing=null">取消</button>
      </div>
      <div v-if="keyMsg" style="margin-top:8px;font-size:13px" :style="{color: keyMsg.type === 'ok' ? 'var(--success)' : 'var(--error)'}">{{ keyMsg.text }}</div>
    </div>
  </div>

  <div class="card token-usage-card">
    <h2>Token 用量</h2>
    <div style="margin-bottom:8px;display:flex;gap:8px;align-items:center">
      <button class="btn btn-sm" @click="loadUsage" :disabled="loadingUsage">{{ loadingUsage ? '加载中...' : '刷新' }}</button>
      <span v-if="usageDays.length" style="font-size:12px;color:var(--text3)">最近 {{ usageDays.length }} 天</span>
    </div>
    <div v-if="usageDays.length" class="token-bars">
      <div class="token-bar-row" v-for="day in usageDays" :key="day.date">
        <span class="token-date">{{ day.date.slice(5) }}</span>
        <div class="token-bars-stack">
          <div v-for="p in usageProviders" :key="p.key" class="token-bar-seg"
            :style="{ width: ((day[p.key] || 0) / usageMax * 100) + '%', background: p.color }"
            :title="p.label + ': ' + (day[p.key] || 0)">
          </div>
        </div>
      </div>
    </div>
    <div v-else style="color:var(--text3);font-size:13px">暂无用量数据</div>
  </div>
</template>

<script>
import { inject, ref, onMounted } from 'vue'
import { fetchKeys, updateKey, fetchKeysUsage } from '../api'

const providerColors = {
  opencode: '#f4c430', dashscope: '#38bdf8', deepseek: '#a78bfa',
  glm: '#34d399', mimorium: '#f472b6'
}

export default {
  name: 'KeyManager',
  setup() {
    const showAdminDialog = inject('showAdminDialog')
    const keys = ref([])
    const editing = ref(null)
    const editValue = ref('')
    const saving = ref(false)
    const keyMsg = ref(null)
    const usageDays = ref([])
    const usageProviders = ref([])
    const usageMax = ref(1)
    const loadingUsage = ref(false)

    onMounted(async () => {
      const res = await fetchKeys()
      if (res.ok) keys.value = res.data
      loadUsage()
    })

    function editKey(k) {
      editing.value = k
      editValue.value = ''
      keyMsg.value = null
    }

    async function saveKey() {
      if (!editValue.value.trim()) return
      saving.value = true
      keyMsg.value = null
      try {
        const res = await updateKey(editing.value.file, editValue.value.trim())
        if (res.code === 'ADMIN_REQUIRED') { if (showAdminDialog) showAdminDialog('修改 Key 需要管理员密码', saveKey); saving.value = false; return }
        if (res.ok) {
          keyMsg.value = { type: 'ok', text: 'Key 已更新并热加载' }
          const reload = await fetchKeys()
          if (reload.ok) keys.value = reload.data
          editing.value = null
        } else {
          keyMsg.value = { type: 'err', text: res.data?.message || '保存失败' }
        }
      } catch (e) { keyMsg.value = { type: 'err', text: e.message } }
      saving.value = false
    }

    async function loadUsage() {
      loadingUsage.value = true
      const res = await fetchKeysUsage()
      if (res.ok && res.data) {
        usageDays.value = res.data.days || []
        usageProviders.value = (res.data.providers || []).map(function(p) {
          return { key: p, label: p, color: providerColors[p] || '#888' }
        })
        let max = 1
        for (const d of usageDays.value) {
          for (const p of usageProviders.value) {
            if (d[p.key] > max) max = d[p.key]
          }
        }
        usageMax.value = max
      }
      loadingUsage.value = false
    }

    return { keys, editing, editValue, saving, keyMsg, editKey, saveKey, usageDays, usageProviders, usageMax, loadingUsage, loadUsage }
  }
}
</script>

<style scoped>
.token-usage-card { margin-top: 16px }
.token-bars { display:flex; flex-direction:column; gap:6px }
.token-bar-row { display:flex; align-items:center; gap:4px }
.token-date { width:36px; font-size:11px; color:var(--text3); text-align:right; flex-shrink:0 }
.token-bars-stack { flex:1; height:14px; border-radius:3px; background:var(--input); overflow:hidden; display:flex }
.token-bar-seg { height:100%; min-width:2px; transition: width .3s ease }
</style>
