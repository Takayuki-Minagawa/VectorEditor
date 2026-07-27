import type * as fabric from 'fabric';

export const OPEN_TRACE_DIALOG_EVENT = 'vectoreditor:open-trace-dialog';

export interface OpenTraceDialogDetail {
  sourceImage?: fabric.Image;
}

export function openTraceDialog(sourceImage?: fabric.Image): void {
  window.dispatchEvent(new CustomEvent<OpenTraceDialogDetail>(
    OPEN_TRACE_DIALOG_EVENT,
    { detail: { sourceImage } },
  ));
}
