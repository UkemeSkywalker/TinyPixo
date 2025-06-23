import React, { useState } from 'react';
import './App.css';
import ImageUploader from './components/ImageUploader';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Image Compressor</h1>
        <p>Compress your images instantly</p>
      </header>
      <main>
        <ImageUploader />
      </main>
      <footer>
        <p>Free image compression service - No login required</p>
      </footer>
    </div>
  );
}

export default App;