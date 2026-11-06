export type InferenceProgress = {
  stage: 'scanning' | 'verifying' | 'loading' | 'quoting' | 'evaluating' | 'saving';
  completedBytes?: number;
  totalBytes?: number;
  startedAt: number;
};

export type ReportInferenceProgress = (stage: InferenceProgress['stage'], completedBytes?: number, totalBytes?: number) => void;
