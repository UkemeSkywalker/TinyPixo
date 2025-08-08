import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AudioConverter from './page'

// Mock fetch globally
global.fetch = vi.fn()

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn(() => 'mock-blob-url')

describe('AudioConverter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the audio converter page', () => {
    render(<AudioConverter />)
    
    expect(screen.getByText('Convert Audio Files')).toBeInTheDocument()
    expect(screen.getByText('Drop your audio files here')).toBeInTheDocument()
  })

  it('shows upload progress when file is selected', async () => {
    // Mock successful upload response
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        fileId: 'test-file-id',
        fileName: 'test.mp3',
        size: 1024000
      })
    } as Response)

    render(<AudioConverter />)
    
    // Create a mock file
    const file = new File(['test content'], 'test.mp3', { type: 'audio/mpeg' })
    
    // Find the file input and upload a file
    const fileInput = screen.getByRole('button', { name: /drop your audio files here/i })
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement
    
    fireEvent.change(hiddenInput, { target: { files: [file] } })
    
    // Wait for upload to complete
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/upload-audio', expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData)
      }))
    })
  })

  it('starts conversion when convert button is clicked', async () => {
    // Mock upload response
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        fileId: 'test-file-id',
        fileName: 'test.mp3',
        size: 1024000
      })
    } as Response)

    // Mock conversion response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jobId: 'test-job-id',
        status: 'created'
      })
    } as Response)

    // Mock progress response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        jobId: 'test-job-id',
        progress: 100,
        stage: 'completed'
      })
    } as Response)

    render(<AudioConverter />)
    
    // Upload a file first
    const file = new File(['test content'], 'test.mp3', { type: 'audio/mpeg' })
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(hiddenInput, { target: { files: [file] } })
    
    // Wait for upload to complete
    await waitFor(() => {
      expect(screen.getByText('Ready')).toBeInTheDocument()
    })

    // Click convert button
    const convertButton = screen.getByRole('button', { name: /convert audio/i })
    fireEvent.click(convertButton)

    // Verify conversion API was called
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/convert-audio', expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileId: 'test-file-id',
          format: 'mp3',
          quality: '192k'
        })
      }))
    })
  })

  it('handles upload errors gracefully', async () => {
    // Mock failed upload response
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'File too large'
      })
    } as Response)

    render(<AudioConverter />)
    
    // Upload a file
    const file = new File(['test content'], 'test.mp3', { type: 'audio/mpeg' })
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(hiddenInput, { target: { files: [file] } })
    
    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByText(/file too large/i)).toBeInTheDocument()
    })
  })

  it('handles conversion errors gracefully', async () => {
    // Mock successful upload
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        fileId: 'test-file-id',
        fileName: 'test.mp3',
        size: 1024000
      })
    } as Response)

    // Mock failed conversion
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: 'Conversion failed'
      })
    } as Response)

    render(<AudioConverter />)
    
    // Upload a file first
    const file = new File(['test content'], 'test.mp3', { type: 'audio/mpeg' })
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(hiddenInput, { target: { files: [file] } })
    
    await waitFor(() => {
      expect(screen.getByText('Ready')).toBeInTheDocument()
    })

    // Try to convert
    const convertButton = screen.getByRole('button', { name: /convert audio/i })
    fireEvent.click(convertButton)

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByText(/conversion failed/i)).toBeInTheDocument()
    })
  })

  it('polls progress during conversion', async () => {
    // Mock upload response
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        fileId: 'test-file-id',
        fileName: 'test.mp3',
        size: 1024000
      })
    } as Response)

    // Mock conversion response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jobId: 'test-job-id',
        status: 'created'
      })
    } as Response)

    // Mock progress responses (50%, then 100%)
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jobId: 'test-job-id',
          progress: 50,
          stage: 'converting'
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jobId: 'test-job-id',
          progress: 100,
          stage: 'completed'
        })
      } as Response)

    // Mock download response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(['converted content'], { type: 'audio/mpeg' })
    } as Response)

    render(<AudioConverter />)
    
    // Upload and convert
    const file = new File(['test content'], 'test.mp3', { type: 'audio/mpeg' })
    const hiddenInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(hiddenInput, { target: { files: [file] } })
    
    await waitFor(() => {
      expect(screen.getByText('Ready')).toBeInTheDocument()
    })

    const convertButton = screen.getByRole('button', { name: /convert audio/i })
    fireEvent.click(convertButton)

    // Wait for progress polling to start
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/progress?jobId=test-job-id', expect.objectContaining({
        headers: {
          'Cache-Control': 'no-cache'
        }
      }))
    })

    // Wait for completion
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/download?jobId=test-job-id')
    }, { timeout: 3000 })
  })
})