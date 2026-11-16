export const taskNameMatches = (name: string, query: string): boolean => {
  const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
  return normalize(name).includes(normalize(query));
};
/** Filtro local: não grava dados, não refaz a ficha e preserva o foco durante a digitação. */
export function filterTaskGroups(root: HTMLElement, query: string, collapsed: Set<string>, expandMatches = false): void {
  for (const group of root.querySelectorAll<HTMLDetailsElement>("[data-task-group]")) {
    const cards = [...group.querySelectorAll<HTMLElement>("[data-task-name]")]; let visible = 0;
    for (const card of cards) { card.hidden = !taskNameMatches(card.dataset.taskName ?? "", query); if (!card.hidden) visible++; }
    const count = group.querySelector<HTMLElement>("[data-task-count]"); if (count) count.textContent = query.trim() ? `${visible} / ${cards.length}` : String(cards.length);
    const empty = group.querySelector<HTMLElement>("[data-task-no-match]"); if (empty) empty.hidden = !query.trim() || !cards.length || visible > 0;
    if(expandMatches&&query.trim()&&visible>0)collapsed.delete(group.dataset.taskGroup!);
    group.open = !collapsed.has(group.dataset.taskGroup!);
  }
}
