import { calculateSectionProperties } from '../utils/sectionProperties';
import type {
  SectionAnalysisRequest,
  SectionAnalysisResponse,
} from './sectionAnalysisProtocol';

interface SectionWorkerScope {
  onmessage: ((event: MessageEvent<SectionAnalysisRequest>) => void) | null;
  postMessage(message: SectionAnalysisResponse): void;
}

const workerScope = self as unknown as SectionWorkerScope;

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type !== 'section-analysis-request' || !Number.isInteger(request.jobId)) return;
  try {
    workerScope.postMessage({
      type: 'section-analysis-success',
      jobId: request.jobId,
      properties: calculateSectionProperties(request.profile),
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'section-analysis-failure',
      jobId: request.jobId,
      message: error instanceof Error ? error.message : 'Section analysis failed.',
    });
  }
};
