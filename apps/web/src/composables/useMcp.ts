import { ref } from "vue";
import { listMcp } from "../api/client.js";
import type { McpServerSummary, McpToolSummary } from "../api/types.js";

export function useMcp() {
  const servers = ref<McpServerSummary[]>([]);
  const tools = ref<McpToolSummary[]>([]);
  const isLoading = ref(true);
  const error = ref<string | null>(null);
  const activeServerIds = ref<string[]>([]);

  function toggleServer(id: string): void {
    if (!servers.value.some((server) => server.id === id && server.status === "ready")) return;
    activeServerIds.value = activeServerIds.value.includes(id)
      ? activeServerIds.value.filter((selected) => selected !== id)
      : [...activeServerIds.value, id];
  }

  async function refreshMcp(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const catalog = await listMcp();
      servers.value = catalog.servers;
      tools.value = catalog.tools;
      activeServerIds.value = activeServerIds.value.filter((id) => catalog.servers.some((server) => server.id === id && server.status === "ready"));
    } catch (cause) {
      servers.value = [];
      tools.value = [];
      activeServerIds.value = [];
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      isLoading.value = false;
    }
  }

  return { servers, tools, activeServerIds, isLoading, error, refreshMcp, toggleServer };
}
