// Audio processing utilities
class AudioProcessor {
    constructor() {
      this.sampleRate = 16000; // Target sample rate for speech recognition
      this.bufferSize = 4096;
    }
  
    // Convert WebM audio buffer to PCM format
    processAudioBuffer(buffer) {
      try {
        // Basic audio processing
        // In a production environment, you might want to use FFmpeg or similar
        // to properly decode WebM audio
        
        // For now, we'll pass the buffer as-is since Gemini can handle WebM
        return buffer;
      } catch (error) {
        console.error('Error processing audio buffer:', error);
        return null;
      }
    }
  
    // Detect silence in audio buffer
    detectSilence(buffer, threshold = 0.01) {
      try {
        // Simple silence detection based on average amplitude
        let sum = 0;
        const samples = new Float32Array(buffer.buffer);
        
        for (let i = 0; i < samples.length; i++) {
          sum += Math.abs(samples[i]);
        }
        
        const average = sum / samples.length;
        return average < threshold;
      } catch (error) {
        console.error('Error detecting silence:', error);
        return false;
      }
    }
  
    // Normalize audio levels
    normalizeAudio(buffer) {
      try {
        const samples = new Float32Array(buffer.buffer);
        let max = 0;
        
        // Find maximum amplitude
        for (let i = 0; i < samples.length; i++) {
          max = Math.max(max, Math.abs(samples[i]));
        }
        
        // Normalize if necessary
        if (max > 0 && max < 0.5) {
          const factor = 0.8 / max;
          for (let i = 0; i < samples.length; i++) {
            samples[i] *= factor;
          }
        }
        
        return Buffer.from(samples.buffer);
      } catch (error) {
        console.error('Error normalizing audio:', error);
        return buffer;
      }
    }
  
    // Calculate audio duration
    calculateDuration(buffer, sampleRate = 16000) {
      try {
        const samples = buffer.length / 4; 
        return samples / sampleRate;
      } catch (error) {
        console.error('Error calculating duration:', error);
        return 0;
      }
    }
  
    // Chunk audio for processing
    chunkAudio(buffer, chunkSizeSeconds = 10) {
      try {
        const chunkSizeBytes = chunkSizeSeconds * this.sampleRate * 4; 
        const chunks = [];
        
        for (let i = 0; i < buffer.length; i += chunkSizeBytes) {
          const chunk = buffer.slice(i, i + chunkSizeBytes);
          chunks.push(chunk);
        }
        
        return chunks;
      } catch (error) {
        console.error('Error chunking audio:', error);
        return [buffer];
      }
    }
  }
  
  module.exports = new AudioProcessor();