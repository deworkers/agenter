import { computed, ref } from "vue";
import { listMcp } from "../api/client.js";
import type { McpServerSummary, McpToolSummary } from "../api/types.js";

export function useMcp() {
  const servers = ref<McpServerSummary[]>([]);
  const tools = ref<McpToolSummary[]>([]);
  const isLoading = ref(true);
  const error = ref<string | null>(null);
  const manualServerIds = ref<string[]>([]);
  const automaticServerIds = ref<string[]>([]);
  const activeServerIds = computed(() => [...manualServerIds.value, ...automaticServerIds.value.filter((id) => !manualServerIds.value.includes(id))]);
  const ready = (id: string): boolean => servers.value.some((server) => server.id === id && server.status === "ready");
  let catalogLoaded = false;

  function toggleServer(id: string): void {
    if (!ready(id)) return;
    if (activeServerIds.value.includes(id)) {
      manualServerIds.value = manualServerIds.value.filter((selected) => selected !== id);
      automaticServerIds.value = automaticServerIds.value.filter((selected) => selected !== id);
    } else manualServerIds.value = [...manualServerIds.value, id];
  }

  function restoreSelection(manual: string[], automatic: string[]): void {
    const selectable = (id: string): boolean => !catalogLoaded || ready(id);
    manualServerIds.value = [...new Set(manual.filter(selectable))];
    automaticServerIds.value = [...new Set(automatic.filter((id) => selectable(id) && !manualServerIds.value.includes(id)))];
  }

  function applySkillServers(required: string[]): void {
    automaticServerIds.value = [...new Set(required.filter((id) => ready(id) && !manualServerIds.value.includes(id)))];
  }

  async function refreshMcp(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const catalog = await listMcp();
      servers.value = catalog.servers;
      tools.value = catalog.tools;
      catalogLoaded = true;
      restoreSelection(manualServerIds.value, automaticServerIds.value);
    } catch (cause) {
      catalogLoaded = true;
      servers.value = [];
      tools.value = [];
      manualServerIds.value = [];
      automaticServerIds.value = [];
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      isLoading.value = false;
    }
  }

  return { servers, tools, activeServerIds, manualServerIds, automaticServerIds, isLoading, error, refreshMcp, toggleServer, restoreSelection, applySkillServers };
}
