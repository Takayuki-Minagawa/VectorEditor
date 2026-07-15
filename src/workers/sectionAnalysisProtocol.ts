import type { SectionProfileData, SectionProperties } from '../domain/section';

export interface SectionAnalysisRequest {
  type: 'section-analysis-request';
  jobId: number;
  profile: SectionProfileData;
}

export interface SectionAnalysisSuccess {
  type: 'section-analysis-success';
  jobId: number;
  properties: SectionProperties;
}

export interface SectionAnalysisFailure {
  type: 'section-analysis-failure';
  jobId: number;
  message: string;
}

export type SectionAnalysisResponse = SectionAnalysisSuccess | SectionAnalysisFailure;

export function isSectionAnalysisResponse(value: unknown): value is SectionAnalysisResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SectionAnalysisResponse>;
  return Number.isInteger(candidate.jobId)
    && (candidate.type === 'section-analysis-success'
      ? typeof candidate.properties === 'object' && candidate.properties !== null
      : candidate.type === 'section-analysis-failure' && typeof candidate.message === 'string');
}
