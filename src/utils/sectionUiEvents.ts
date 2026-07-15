export const OPEN_SECTION_OPERATIONS_EVENT = 'vector-editor:open-section-operations';

export function openSectionOperations(): void {
  window.dispatchEvent(new Event(OPEN_SECTION_OPERATIONS_EVENT));
}
