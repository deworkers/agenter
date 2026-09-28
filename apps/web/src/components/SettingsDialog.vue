<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSettings } from "../composables/useSettings.js";
import { getSkill, removeSkill, updateSkill } from "../api/client.js";
import type { McpToolSummary, NewSkillInput, SkillSummary } from "../api/types.js";
import SkillDialog from "./SkillDialog.vue";
import ResourceDialog from "./ResourceDialog.vue";
import { stageResource, type ResourceDraft } from "../composables/resourceDrafts.js";

const props = defineProps<{ skills: SkillSummary[]; tools: McpToolSummary[] }>();
const emit = defineEmits<{ close: []; saved: []; skillsChanged: []; addSkill: [] }>();
const { settings, environment, loading, saving, error, notice, testing, load, save, test } = useSettings();
const section = ref("models");
const selectedModel = ref("");
const selectedServer = ref("");
const adding = ref<"model" | "mcp" | null>(null);
const editor = ref<NewSkillInput | null>(null);
const skillSaving = ref(false);
const skillError = ref<string | null>(null);
const discovered = ref<Record<string, Array<{ name: string; description: string }>>>({});
const model = computed(() => settings.value?.providers[selectedModel.value]);
const server = computed(() => settings.value?.mcpServers[selectedServer.value]);
const serverTools = computed(() => discovered.value[selectedServer.value] ?? props.tools.filter((tool) => tool.source.serverId === selectedServer.value).map((tool) => ({ name: tool.name.slice(selectedServer.value.length + 2), description: tool.description })));
onMounted(async () => { await load(); selectedModel.value = settings.value?.defaultProvider ?? ""; selectedServer.value = Object.keys(settings.value?.mcpServers ?? {})[0] ?? ""; });
function add(draft: ResourceDraft): void {
  if (!settings.value) return;
  try {
    stageResource(settings.value, draft);
    if (draft.kind === "model") selectedModel.value = draft.id;
    else selectedServer.value = draft.id;
    adding.value = null; error.value = "";
    notice.value = "Запись добавлена в список. Сохраните настройки для применения.";
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Не удалось добавить запись"; }
}
function remove(kind: "model" | "mcp"): void {
  if (!settings.value) return;
  if (kind === "model") {
    if (selectedModel.value === settings.value.defaultProvider || Object.values(settings.value.routes).some((route) => route.provider === selectedModel.value)) { error.value = "Сначала выберите другую модель в маршрутах и по умолчанию"; return; }
    delete settings.value.providers[selectedModel.value]; selectedModel.value = settings.value.defaultProvider;
  } else { delete settings.value.mcpServers[selectedServer.value]; selectedServer.value = Object.keys(settings.value.mcpServers)[0] ?? ""; }
}
function changeTransport(value: string): void {
  if (!settings.value || !server.value) return;
  const common = { enabled: server.value.enabled, allowedTools: server.value.allowedTools };
  settings.value.mcpServers[selectedServer.value] = value === "sse" ? { ...common, transport: "sse", url: "" } : { ...common, transport: "stdio", command: "", args: [], env: {} };
}
function parseServerField(field: "args" | "env", value: string): void {
  try {
    const parsed: unknown = JSON.parse(value);
    if (field === "args" && Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) server.value!.args = parsed;
    else if (field === "env" && parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && Object.values(parsed).every((item) => typeof item === "string")) server.value!.env = parsed as Record<string, string>;
    else throw new Error();
    error.value = "";
  } catch { error.value = `Поле ${field} должно содержать корректный JSON`; }
}
function allow(name: string, checked: boolean): void {
  if (!server.value) return;
  const list = server.value.allowedTools ?? [];
  server.value.allowedTools = checked ? [...new Set([...list, name])] : list.filter((item) => item !== name);
}
async function checkServer(): Promise<void> {
  const result = await test("mcp", selectedServer.value);
  if (result?.tools) discovered.value[selectedServer.value] = result.tools;
}
async function editSkill(id: string): Promise<void> {
  skillError.value = null;
  try { editor.value = await getSkill(id); } catch { error.value = "Не удалось прочитать навык"; }
}
async function saveSkill(input: NewSkillInput): Promise<void> {
  skillSaving.value = true;
  try { await updateSkill(input); editor.value = null; emit("skillsChanged"); }
  catch (cause) { skillError.value = cause instanceof Error ? cause.message : "Не удалось сохранить навык"; }
  finally { skillSaving.value = false; }
}
async function deleteSkill(id: string): Promise<void> {
  if (!window.confirm(`Удалить навык ${id}? Файл останется в резервной копии.`)) return;
  try { await removeSkill(id); emit("skillsChanged"); } catch { error.value = "Не удалось удалить навык"; }
}
async function persist(): Promise<void> { if (await save()) emit("saved"); }
</script>

<template>
  <div
    class="dialog-backdrop"
    @keydown.esc="emit('close')"
  >
    <section
      class="settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <header class="skill-dialog-header">
        <div>
          <h2 id="settings-title">
            Настройки
          </h2><p>Модели, маршруты, MCP и навыки</p>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="Закрыть настройки"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <nav
        class="settings-tabs"
        aria-label="Разделы настроек"
      >
        <button
          v-for="item in [{id:'models',label:'Модели'}, {id:'routes',label:'Auto'}, {id:'mcp',label:'MCP'}, {id:'skills',label:'Навыки'}]"
          :key="item.id"
          type="button"
          :class="{active:section===item.id}"
          :aria-pressed="section===item.id"
          @click="section=item.id"
        >
          {{ item.label }}
        </button>
      </nav>
      <div class="settings-body">
        <p v-if="loading">
          Загружаем настройки…
        </p>
        <template v-if="settings">
          <template v-if="section==='models'">
            <div class="settings-resource-list">
              <button
                v-for="(entry,id) in settings.providers"
                :key="id"
                type="button"
                :class="{active:selectedModel===id}"
                @click="selectedModel=String(id)"
              >
                {{ entry.label || id }} <span v-if="entry.enabled===false">· выключена</span>
              </button>
            </div>
            <div class="settings-add">
              <button
                class="secondary-button"
                type="button"
                @click="adding='model'"
              >
                Добавить модель
              </button>
            </div>
            <div
              v-if="model"
              class="settings-form"
            >
              <label>Название<input
                v-model="model.label"
                placeholder="Например, Локальная модель"
              ></label>
              <label>Endpoint<input
                v-model="model.baseUrl"
                placeholder="http://localhost:1234/v1"
              ></label>
              <label>Модель<input
                v-model="model.model"
                placeholder="Идентификатор модели на сервере"
              ></label>
              <label>Переменная ключа<input
                v-model="model.apiKey"
                placeholder="${OPENAI_API_KEY}"
              ><small>Ссылка ${ENV_NAME}; для локального сервера можно указать local.</small><small v-if="model.apiKey.startsWith('${')">{{ environment[model.apiKey.slice(2,-1)] ? 'Переменная задана' : 'Переменная не задана; после изменения .env перезапустите API' }}</small></label>
              <div class="settings-columns">
                <label>Окно контекста<input
                  v-model.number="model.contextWindow"
                  type="number"
                  min="128"
                ></label><label>Лимит ответа<input
                  v-model.number="model.maxOutputTokens"
                  type="number"
                  min="1"
                ></label>
              </div>
              <label>Таймаут, мс<input
                v-model.number="model.timeoutMs"
                type="number"
                min="1000"
                max="3600000"
              ></label>
              <label class="check-label"><input
                type="checkbox"
                :checked="model.enabled!==false"
                @change="model.enabled=($event.target as HTMLInputElement).checked"
              >Модель включена</label>
              <label class="check-label"><input
                type="checkbox"
                :checked="model.supportsTools!==false"
                @change="model.supportsTools=($event.target as HTMLInputElement).checked"
              >Поддерживает вызов инструментов</label>
              <label>Модель по умолчанию<select v-model="settings.defaultProvider"><option
                v-for="(entry,id) in settings.providers"
                :key="id"
                :value="id"
                :disabled="entry.enabled===false"
              >{{ entry.label || id }}</option></select></label>
              <div class="settings-inline-actions">
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="testing"
                  @click="test('model',selectedModel)"
                >
                  {{ testing ? 'Проверяем…' : 'Проверить endpoint' }}
                </button><button
                  class="danger-button"
                  type="button"
                  @click="remove('model')"
                >
                  Удалить модель
                </button>
              </div>
            </div>
          </template>
          <div
            v-else-if="section==='routes'"
            class="settings-form"
          >
            <p>Auto выбирает модель по активному навыку и наличию инструментов.</p>
            <label
              v-for="task in ['simple','coding','reasoning','research','vision']"
              :key="task"
            >{{ task }}<select v-model="settings.routes[task]!.provider"><option
              v-for="(entry,id) in settings.providers"
              :key="id"
              :value="id"
              :disabled="entry.enabled===false"
            >{{ entry.label || id }}</option></select></label>
          </div>
          <template v-else-if="section==='mcp'">
            <div class="settings-resource-list">
              <button
                v-for="(entry,id) in settings.mcpServers"
                :key="id"
                type="button"
                :class="{active:selectedServer===id}"
                @click="selectedServer=String(id)"
              >
                {{ id }}{{ entry.enabled===false ? ' · выключен' : '' }}
              </button>
            </div>
            <div class="settings-add">
              <button
                class="secondary-button"
                type="button"
                @click="adding='mcp'"
              >
                Добавить MCP
              </button>
            </div>
            <div
              v-if="server"
              class="settings-form"
            >
              <label class="check-label"><input
                type="checkbox"
                :checked="server.enabled!==false"
                @change="server.enabled=($event.target as HTMLInputElement).checked"
              >Подключать сервер</label>
              <label>Транспорт<select
                :value="server.transport || 'stdio'"
                @change="changeTransport(($event.target as HTMLSelectElement).value)"
              ><option value="sse">HTTP + SSE</option><option value="stdio">stdio</option></select></label>
              <label v-if="server.transport==='sse'">URL<input
                v-model="server.url"
                placeholder="http://localhost:8001/servers/name/sse"
              ></label>
              <template v-else>
                <label>Команда<input v-model="server.command"></label><label>Аргументы (JSON)<textarea
                  :value="JSON.stringify(server.args ?? [],null,2)"
                  rows="3"
                  @change="parseServerField('args',($event.target as HTMLTextAreaElement).value)"
                /></label><label>Переменные окружения (JSON)<textarea
                  :value="JSON.stringify(server.env ?? {},null,2)"
                  rows="3"
                  @change="parseServerField('env',($event.target as HTMLTextAreaElement).value)"
                /><small>Для ключей и токенов используйте ${ENV_NAME}.</small></label>
              </template>
              <div class="settings-inline-actions">
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="testing"
                  @click="checkServer"
                >
                  {{ testing ? 'Подключаем…' : 'Проверить и получить инструменты' }}
                </button><button
                  class="danger-button"
                  type="button"
                  @click="remove('mcp')"
                >
                  Удалить сервер
                </button>
              </div>
              <label class="check-label"><input
                type="checkbox"
                :checked="server.allowedTools===undefined"
                @change="server.allowedTools=($event.target as HTMLInputElement).checked ? undefined : []"
              >Разрешить все функции сервера</label>
              <small v-if="server.allowedTools===undefined">Разрешены все функции, включая операции записи. Для ограничения снимите переключатель.</small>
              <template v-else>
                <p>Разрешено: {{ server.allowedTools.length }}. Пустой список запрещает все вызовы.</p><label
                  v-for="tool in serverTools"
                  :key="tool.name"
                  class="settings-tool"
                ><input
                  type="checkbox"
                  :checked="server.allowedTools.includes(tool.name)"
                  @change="allow(tool.name,($event.target as HTMLInputElement).checked)"
                ><span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span></label><p v-if="!serverTools.length">
                  Проверьте подключение, чтобы получить список функций.
                </p>
              </template>
            </div>
          </template>
          <template v-else>
            <p>Навыки сохраняются отдельно. Изменения доступны для следующих сообщений.</p>
            <button
              class="secondary-button"
              type="button"
              @click="emit('addSkill')"
            >
              Создать навык
            </button>
            <div
              v-for="skill in skills"
              :key="skill.id"
              class="settings-skill"
            >
              <div><strong>{{ skill.name }}</strong><small>{{ skill.description }}{{ skill.enabled===false ? ' · выключен' : '' }}</small></div><button
                class="secondary-button"
                type="button"
                @click="editSkill(skill.id)"
              >
                Изменить
              </button><button
                class="danger-button"
                type="button"
                @click="deleteSkill(skill.id)"
              >
                Удалить
              </button>
            </div>
          </template>
        </template>
        <p
          v-if="error"
          class="skill-form-error"
          role="alert"
        >
          {{ error }}
        </p>
        <p
          v-if="notice"
          class="settings-notice"
          role="status"
        >
          {{ notice }}
        </p>
      </div>
      <footer class="settings-footer">
        <small>Изменения моделей, Auto и MCP применяются после сохранения.</small><button
          class="primary-button"
          type="button"
          :disabled="loading || saving || !settings"
          @click="persist"
        >
          {{ saving ? 'Применяем…' : 'Сохранить настройки' }}
        </button>
      </footer>
    </section>
    <SkillDialog
      v-if="editor"
      :initial="editor"
      :saving="skillSaving"
      :error="skillError"
      @close="editor=null"
      @create="saveSkill"
    />
    <ResourceDialog
      v-if="adding && settings"
      :kind="adding"
      :existing-ids="Object.keys(adding === 'model' ? settings.providers : settings.mcpServers)"
      @close="adding=null"
      @create="add"
    />
  </div>
</template>
