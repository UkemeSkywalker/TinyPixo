interface ConversionProgress {
  jobId: string
  progress: number
  status?: string
  startTime?: number
  estimatedTimeRemaining?: number | null
  outputBuffer?: Buffer
  outputPath?: string
  format?: string
}

declare global {
  var conversionProgress: Record<string, ConversionProgress> | undefined
}

export {}