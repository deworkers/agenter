export interface SelectableMcpTool {
  name: string;
  description: string;
}

export function filterMcpTools(
  tools: SelectableMcpTool[], selected: string[] | undefined, query: string, activeOnly: boolean,
): SelectableMcpTool[] {
  const search = query.trim().toLocaleLowerCase();
  const active = selected === undefined ? undefined : new Set(selected);
  return tools.filter(tool => (!activeOnly || active === undefined || active.has(tool.name))
    && (!search || `${tool.name} ${tool.description}`.toLocaleLowerCase().includes(search)));
}

export function selectMcpTools(
  tools: SelectableMcpTool[], selected: string[] | undefined, names: string[], checked: boolean,
): string[] {
  const next = new Set(selected ?? tools.map(tool => tool.name));
  for (const name of names) {
    if (checked) next.add(name);
    else next.delete(name);
  }
  return [...next];
}

export function summarizeMcpSelection(tools: SelectableMcpTool[], selected: string[] | undefined) {
  const catalog = new Set(tools.map(tool => tool.name));
  const active = new Set(selected ?? catalog);
  return {
    activeCount: [...catalog].filter(name => active.has(name)).length,
    unavailableNames: [...active].filter(name => !catalog.has(name)),
  };
}
