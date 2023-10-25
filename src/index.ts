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
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: true
    },
    interimResults: true // If you want interim results, set this to true
  };
  let averageSpeedWPM = 0;
  const recognizeStream = speechClient
    .streamingRecognize(request as any)
    .on('error', (err) => console.log(err))
    .on('data', (data) => {
      const isFinal = data.results[0].isFinal;
      const transcript = data.results[0].alternatives[0].transcript;

      if (isFinal) {
        const speechClarity = data.results[0].alternatives[0].confidence;
        const wordLengthsSeconds = data.results[0].alternatives[0].words.map(
          (word: any) => {
            const startTimeSeconds =
              word.startTime.seconds + word.startTime.nanos * 1e-9;
            const endTimeSeconds =
              word.endTime.seconds + word.endTime.nanos * 1e-9;
            return endTimeSeconds - startTimeSeconds;
          }
        );
        const wordLengths = wordLengthsSeconds.reduce(
          (acc: number, curr: number) => acc + curr,
          0
        );
        const wordsInBlock = wordLengthsSeconds.length;
        let averageSpeedWPMCurrent: undefined | number = undefined;
        if (wordsInBlock === 0) {
          averageSpeedWPMCurrent = undefined;
        } else {
          averageSpeedWPMCurrent = wordsInBlock / (wordLengths / 60);
          averageSpeedWPM = (averageSpeedWPM + averageSpeedWPMCurrent) / 2;
        }

        return socket.emit('transcript', {
          transcript,
          isFinal,
          speechClarity,
          averageSpeedWPMCurrent,
          averageSpeedWPM
        });
      }

      return socket.emit('transcript', { transcript, isFinal });
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
