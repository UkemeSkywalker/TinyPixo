import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GET } from '../app/api/jobs/[jobId]/route'
import { jobService } from '../lib/job-service'
import { JobStatus } from '../lib/job-service'

// Mock the job service
vi.mock('../lib/job-service', () => ({
  jobService: {
    getJob: vi.fn()
  }
}))

describe('Jobs API', () => {
  describe('GET /api/jobs/[jobId]', () => {
    it('should return job details when job exists', async () => {
      const mockJob = {
        jobId: '123',
        status: JobStatus.PROCESSING,
        inputS3Location: {
          bucket: 'test-bucket',
          key: 'input/file.mp3',
          size: 1024000
        },
        format: 'wav',
        quality: '192k',
        createdAt: new Date('2022-01-01T00:00:00.000Z'),
        updatedAt: new Date('2022-01-01T00:05:00.000Z'),
        ttl: 1641081600
      }

      vi.mocked(jobService.getJob).mockResolvedValueOnce(mockJob)

      const request = new Request('http://localhost:3000/api/jobs/123')
      const response = await GET(request, { params: { jobId: '123' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual(mockJob)
      expect(jobService.getJob).toHaveBeenCalledWith('123')
    })

    it('should return 404 when job does not exist', async () => {
      vi.mocked(jobService.getJob).mockResolvedValueOnce(null)

      const request = new Request('http://localhost:3000/api/jobs/nonexistent')
      const response = await GET(request, { params: { jobId: 'nonexistent' } })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toEqual({ error: 'Job not found' })
    })

    it('should return 400 when jobId is missing', async () => {
      const request = new Request('http://localhost:3000/api/jobs/')
      const response = await GET(request, { params: { jobId: '' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: 'Job ID is required' })
    })

    it('should return 500 when service throws error', async () => {
      vi.mocked(jobService.getJob).mockRejectedValueOnce(new Error('Database error'))

      const request = new Request('http://localhost:3000/api/jobs/123')
      const response = await GET(request, { params: { jobId: '123' } })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toEqual({
        error: 'Failed to retrieve job details',
        details: 'Database error'
      })
    })
  })
})