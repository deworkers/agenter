import { ref } from "vue";
import { listProviders } from "../api/client.js";
import type { ProviderSummary } from "../api/types.js";

export function useProviders() {
  const providers = ref<ProviderSummary[]>([]);
  const defaultProviderId = ref("");
  const selectedProviderId = ref("");
  const isLoading = ref(true);
  const error = ref<string | null>(null);

  async function refreshProviders(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const catalog = await listProviders();
      if (!catalog.providers.some((provider) => provider.id === catalog.defaultProviderId)) {
        throw new Error("No default provider available. Check the server configuration.");
      }
      providers.value = catalog.providers;
      defaultProviderId.value = catalog.defaultProviderId;
      if (selectedProviderId.value !== "auto" && !catalog.providers.some((provider) => provider.id === selectedProviderId.value)) {
        selectedProviderId.value = "auto";
      }
    } catch (cause) {
      providers.value = [];
      selectedProviderId.value = "";
      defaultProviderId.value = "";
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      isLoading.value = false;
    }
  }

  return { providers, defaultProviderId, selectedProviderId, isLoading, error, refreshProviders };
}
