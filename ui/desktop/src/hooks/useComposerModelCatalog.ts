import { useCallback, useEffect, useRef, useState } from 'react';
import { acpListSettingsProviderDetails } from '../acp/providers';
import { acpReadConfig } from '../acp/config';
import {
  fetchModelsForProviders,
  type ProviderModelsResult,
} from '../components/settings/models/modelInterface';
import type { ProviderDetails } from '../types/providers';

export async function listComposerProviders(
  currentProvider: string | null
): Promise<ProviderDetails[]> {
  const [items, saved] = await Promise.all([
    acpListSettingsProviderDetails(),
    acpReadConfig('providers'),
  ]);
  const entries = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  const candidates = items.map((item) => {
    if (!item.is_configured) return null;
    const entry = entries[item.name] as { configured?: boolean; enabled?: boolean } | undefined;
    if (
      item.name === currentProvider ||
      item.provider_type === 'Custom' ||
      (entry?.configured && entry.enabled)
    )
      return item;
    return null;
  });
  return candidates.filter((item): item is ProviderDetails => item !== null);
}

export function useComposerModelCatalog(currentProvider: string | null = null) {
  const [providers, setProviders] = useState<ProviderDetails[]>([]);
  const [providerResults, setProviderResults] = useState<Record<string, ProviderModelsResult>>({});
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const inFlight = useRef(new Set<string>());
  const requestGeneration = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingProviders(true);
    void listComposerProviders(currentProvider)
      .then((items) => {
        if (!cancelled) setProviders(items);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoadingProviders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [generation, currentProvider]);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
    },
    []
  );

  const loadProviderModels = useCallback(
    async (providerId: string) => {
      const provider = providers.find((item) => item.name === providerId);
      if (!provider || providerResults[providerId] || inFlight.current.has(providerId)) return;
      inFlight.current.add(providerId);
      const request = requestGeneration.current;
      setLoadingModels(true);
      setError(null);
      try {
        const [result] = await fetchModelsForProviders([provider]);
        if (request !== requestGeneration.current) return;
        setProviderResults((current) => ({ ...current, [providerId]: result }));
        if (result.error) setError(result.error);
      } catch (cause) {
        if (request !== requestGeneration.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (request === requestGeneration.current) {
          inFlight.current.delete(providerId);
          setLoadingModels(inFlight.current.size > 0);
        }
      }
    },
    [providers, providerResults]
  );

  const refresh = useCallback(() => {
    requestGeneration.current += 1;
    inFlight.current.clear();
    setLoadingModels(false);
    setProviders([]);
    setProviderResults({});
    setError(null);
    setGeneration((value) => value + 1);
  }, []);

  return {
    providers,
    providerResults,
    loadingProviders,
    loadingModels,
    error,
    loadProviderModels,
    refresh,
  };
}
