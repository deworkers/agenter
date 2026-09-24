import { ref } from "vue";
import { listMcp } from "../api/client.js";
import type { McpServerSummary, McpToolSummary } from "../api/types.js";

export function useMcp() {
  const servers = ref<McpServerSummary[]>([]);
  const tools = ref<McpToolSummary[]>([]);
  const isLoading = ref(true);
  const error = ref<string | null>(null);

  async function refreshMcp(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const catalog = await listMcp();
      servers.value = catalog.servers;
      tools.value = catalog.tools;
    } catch (cause) {
      servers.value = [];
      tools.value = [];
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      isLoading.value = false;
    }
  }

  return { servers, tools, isLoading, error, refreshMcp };
}
