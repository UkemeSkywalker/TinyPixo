# Image Compression SaaS

A simple web application for compressing images with format conversion options.

## Features

- Upload images for compression
- Select output format (JPEG, PNG, WebP, AVIF)
- Adjust quality settings
- Download compressed images
- No login required - free and open service
- No image storage - all processing happens on-the-fly

## Project Structure

```
image-compressor/
├── backend/         # Express.js server
│   └── src/         # Backend source code
├── frontend/        # React.js application
│   ├── public/      # Static files
│   └── src/         # Frontend source code
```

## Setup Instructions

### Backend Setup

1. Navigate to the backend directory:
   ```
   cd backend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the server:
   ```
   npm run dev
   ```
   The server will run on http://localhost:5000

### Frontend Setup

1. Navigate to the frontend directory:
   ```
   cd frontend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the development server:
   ```
   npm start
   ```
   The application will open in your browser at http://localhost:3000

## Technologies Used

- **Backend**: Node.js, Express, Sharp (image processing)
- **Frontend**: React.js, Axios

## License

MIT