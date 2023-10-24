import 'dotenv/config';
import { Server } from 'socket.io';
import { SpeechClient } from '@google-cloud/speech';

const io = new Server(3001, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log('A user connected');
  const speechClient = new SpeechClient();
  const request = {
    config: {
      encoding: 'WEBM_OPUS',
      sampleRateHertz: 16000,
      languageCode: 'en-US'
    },
    interimResults: true // If you want interim results, set this to true
  };

  const recognizeStream = speechClient
    .streamingRecognize(request as any)
    .on('error', (err) => console.log(err))
    .on('data', (data) => {
      const isFinal = data.results[0].isFinal;
      const transcript = data.results[0].alternatives[0].transcript;
      const speechClarity = data.results[0].alternatives[0].confidence;
    
      socket.emit('transcript', { transcript, isFinal, speechClarity });
    })
    .on('end', () => {
      console.log('end');
    });

  socket.on('audio', (data: Blob) => {
    recognizeStream.write(data);
  });

  socket.on('disconnect', () => {
    recognizeStream.end();
    console.log('A user disconnected');
  });
});
