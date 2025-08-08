// Test setup file for vitest
import { beforeAll, afterAll } from 'vitest'
import '@testing-library/jest-dom'

// Set environment variables for testing
process.env.NODE_ENV = 'test'
process.env.DOCKER_ENV = 'false'

// Mock console methods to reduce noise during tests
const originalConsoleLog = console.log
const originalConsoleError = console.error

beforeAll(() => {
  // Optionally suppress console output during tests
  // Uncomment these lines if you want quieter test output
  // console.log = () => {}
  // console.error = () => {}
})

afterAll(() => {
  // Restore console methods
  console.log = originalConsoleLog
  console.error = originalConsoleError
})