import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

// Mock the progress service
vi.mock('../../../lib/progress-service', () => ({
  progressService: {
    getProgress: vi.fn()
  }
}))

describe('Progress API Route', () => {
  let mockProgressService: any

  beforeAll(() => {
    // Mock console methods to reduce test noise
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    // Get the mocked progress service
    const { progressService } = require('../../../lib/progress-service')
    mockProgressService = progressService
    vi.clearAllMocks()
  })

  describe('GET /api/progress', () => {
    it('should return 400 when jobId is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/progress')
      
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('No job ID provided')
    })

    it('should return progress data when job exists', async () => {
      const mockProgressData = {
        jobId: 'test-job-123',
        progress: 75,
        stage: 'converting',
        estimatedTimeRemaining: 30
      }

      mockProgressService.getProgress.mockResolvedValueOnce(mockProgressData)

      const request = new NextRequest('http://localhost:3000/api/progress?jobId=test-job-123')
      
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual(mockProgressData)
      expect(mockProgressService.getProgress).toHaveBeenCalledWith('test-job-123')
    })

    it('should return 404 when job not found', async () => {
      mockProgressService.getProgress.mockResolvedValueOnce(null)

      const request = new NextRequest('http://localhost:3000/api/progress?jobId=non-existent')
      
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Job not found')
    })

    it('should return proper cache headers', async () => {
      const mockProgressData = {
        jobId: 'test-job-123',
        progress: 50,
        stage: 'processing'
      }

      mockProgressService.getProgress.mockResolvedValueOnce(mockProgressData)

      const request = new NextRequest('http://localhost:3000/api/progress?jobId=test-job-123')
      
      const response = await GET(request)

      expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate')
      expect(response.headers.get('Pragma')).toBe('no-cache')
      expect(response.headers.get('Expires')).toBe('0')
      expect(response.headers.get('X-Response-Time')).toMatch(/\d+ms/)
    })

    it('should handle service errors gracefully', async () => {
      mockProgressService.getProgress.mockRejectedValueOnce(new Error('Service error'))

      const request = new NextRequest('http://localhost:3000/api/progress?jobId=test-job-123')
      
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to get progress')
      expect(response.headers.get('X-Response-Time')).toMatch(/\d+ms/)
    })

    it('should include response time in headers', async () => {
      const mockProgressData = {
        jobId: 'test-job-123',
        progress: 100,
        stage: 'completed'
      }

      mockProgressService.getProgress.mockResolvedValueOnce(mockProgressData)

      const request = new NextRequest('http://localhost:3000/api/progress?jobId=test-job-123')
      
      const response = await GET(request)

      const responseTime = response.headers.get('X-Response-Time')
      expect(responseTime).toMatch(/^\d+ms$/)
    })

    it('should handle different progress stages', async () => {
      const testCases = [
        { progress: 0, stage: 'initialized' },
        { progress: 25, stage: 'converting' },
        { progress: 100, stage: 'completed' },
        { progress: -1, stage: 'failed', error: 'Process failed' }
      ]

      for (const testCase of testCases) {
        const mockProgressData = {
          jobId: 'test-job-123',
          ...testCase
        }

        mockProgressService.getProgress.mockResolvedValueOnce(mockProgressData)

        const request = new NextRequest('http://localhost:3000/api/progress?jobId=test-job-123')
        
        const response = await GET(request)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.progress).toBe(testCase.progress)
        expect(data.stage).toBe(testCase.stage)
        
        if (testCase.error) {
          expect(data.error).toBe(testCase.error)
        }
      }
    })
  })
})