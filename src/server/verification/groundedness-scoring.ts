export interface DimensionScore {
  score: number;
  details: string;
}

export interface GroundednessResult {
  accuracy: DimensionScore;
  precision: DimensionScore;
  groundedness: DimensionScore;
  overall: number;
}
