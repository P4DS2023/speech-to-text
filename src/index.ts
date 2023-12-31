import 'dotenv/config';
import { Server } from 'socket.io';
import { SpeechClient } from '@google-cloud/speech';
import jwt from 'jsonwebtoken';

type TranscriptResponseNonFinal = {
  transcript: string;
  isFinal: false;
};

type TranscriptResponseFinal = {
  transcript: string;
  isFinal: true;
  speechClarity: number;
  speedWPM: number;
};

type TranscriptResponse = TranscriptResponseNonFinal | TranscriptResponseFinal;

const io = new Server(3000, {
  cors: {
    origin: '*'
  }
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const publicKey = process.env.CLERK_PEM_PUBLIC_KEY!.replace(/\\n/g, '\n');

  if (!publicKey) {
    console.error('Authentication error. No public key found');
    return next(new Error('Authentication error. No public key found'));
  }
  if (!token) {
    console.error('Authentication error. No token found');
    return next(new Error('Authentication error. No token found'));
  }

  console.log('Token: ' + token);
  console.log('Public Key: ' + publicKey);

  try {
    const decoded = jwt.verify(token, publicKey);
    next();
  } catch (err) {
    console.error('Authentication error. Invalid token');
    console.log(err);
    console.log('Token:' + token);
    console.log('Public Key:' + publicKey);
    return next(new Error('Authentication error. Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log('A user connected');
  const keyFileParsed = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS!);
  const speechClient = new SpeechClient({
    credentials: keyFileParsed
  });
  const request = {
    config: {
      encoding: 'WEBM_OPUS',
      sampleRateHertz: 16000,
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: true
    },
    interimResults: true // If you want interim results, set this to true
  };
  const recognizeStream = speechClient
    .streamingRecognize(request as any)
    .on('error', (err) => console.log(err))
    .on('data', (data) => {
      const response = data.results[0];

      if (response.isFinal) {
        const transcriptResponse = generateFinalTranscriptResponse(response);
        socket.emit('transcript', transcriptResponse);
      } else {
        const transcriptResponse = generateNonFinalTranscriptResponse(response);
        socket.emit('transcript', transcriptResponse);
      }
    })
    .on('end', () => {
      console.log('End of stream');
      socket.emit('server_completed');
    });

  socket.on('audio', (data: Blob) => {
    recognizeStream.write(data);
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected. Shutting down stream completely');
    recognizeStream.end();
  });

  socket.on('client_completed', async () => {
    console.log("Received event 'client_completed' from client");
    // Once the stream is fully processed. End event is called which then again calls server completed event
    recognizeStream.end();
  });
});

function generateFinalTranscriptResponse(
  response: any
): TranscriptResponseFinal | null {
  const wordLengthsSeconds = response.alternatives[0].words.map((word: any) => {
    const startTimeSeconds =
      word.startTime.seconds + word.startTime.nanos * 1e-9;
    const endTimeSeconds = word.endTime.seconds + word.endTime.nanos * 1e-9;
    return endTimeSeconds - startTimeSeconds;
  });
  const wordLengths = wordLengthsSeconds.reduce(
    (acc: number, curr: number) => acc + curr,
    0
  );
  const wordsInBlock = wordLengthsSeconds.length;

  if (wordsInBlock === 0) {
    return null;
  }

  const speedWPM = wordsInBlock / (wordLengths / 60);
  const speechClarity = response.alternatives[0].confidence;

  return {
    transcript: response.alternatives[0].transcript,
    isFinal: true,
    speechClarity,
    speedWPM
  };
}

function generateNonFinalTranscriptResponse(response: any) {
  return {
    transcript: response.alternatives[0].transcript,
    isFinal: false
  };
}
