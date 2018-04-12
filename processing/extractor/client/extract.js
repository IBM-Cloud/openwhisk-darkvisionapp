/**
 * Copyright 2016 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const async = require('async');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const tmp = require('tmp');
const rimraf = require('rimraf');

// Show some info about the docker action
try {
  console.log('Docker action built on:', require('./build.json').date);
} catch (err) {
  console.log('No build.json file found', err);
}

// argv[2] is expected to be the payload JSON object as a string
const payload = JSON.parse(process.argv[2]);

console.log('Payload', payload);
const doc = payload.doc;

const extractOptions = {
  videoThumbnailSize: 640,
  speechDuration: 15 * 60 // export only the first 15 minutes of audio
};

function getFps(durationInSeconds) {
  // this gives around 15 images per video
  return `1/${Math.ceil(durationInSeconds / 15)}`;

  // for a more complete analysis,
  // use this code that will extract up to 100 images
  /*
  if (durationInSeconds <= 10) {
    return '2/1'; // 2 images per seconds
  } else if (durationInSeconds > 10 && durationInSeconds <= 100) {
    return '1/1'; // 1 image per seconds
  } else { // eslint-disable-line no-else-return
    return `1/${Math.ceil(durationInSeconds / 100)}`;
  }
  */
}

// create a temporary directory to process the video
const workingDirectory = tmp.dirSync({
  prefix: `extractor-${doc._id}`
});
// plan to clean up temp directories
tmp.setGracefulCleanup();
console.log('Using temp dir', workingDirectory.name);

const framesDirectory = `${workingDirectory.name}/frames`;
fs.mkdirSync(framesDirectory);

let mediaStorage;
let videoDocument;
const inputFilename = `${workingDirectory.name}/video.mp4`;

async.waterfall([
  // establish the storage connection if configured in payload
  function(callback) {
    if (payload.cosApiKey) {
      require('./lib/cloudobjectstorage')({
        endpoint: payload.cosEndpoint,
        apikey: payload.cosApiKey,
        instanceId: payload.cosInstanceId,
        bucket: payload.cosBucket,
      }, (err, fileStore) => {
        if (err) {
          callback(err);
        } else {
          callback(null, fileStore);
        }
      });
      console.log('Media files are stored in Cloud Object Storage.');
    } else {
      console.log('Media files are stored in Cloudant.');
      callback(null, null);
    }
  },
  // connect to the database
  (initializedFileStore, callback) => {
    console.log('Initializing Cloudant...');
    mediaStorage = require('./lib/cloudantstorage')({
      cloudantUrl: payload.cloudantUrl,
      cloudantDbName: payload.cloudantDbName,
      fileStore: initializedFileStore
    });
    callback(null);
  },
  // load the document from the database
  (callback) => {
    mediaStorage.get(doc._id, (err, body) => {
      if (err) {
        callback(err);
      } else {
        videoDocument = body;
        console.log('Video is', videoDocument);

        // if metadata exists we consider this document as already processed and do nothing
        if (videoDocument.metadata) {
          callback('already processed');
        } else {
          callback(null);
        }
      }
    });
  },
  // save its video attachment to disk
  (callback) => {
    console.log('Downloading video attachment...');
    const videoStream = fs.createWriteStream(inputFilename);
    const totalSize = mediaStorage.getAttachmentSize(videoDocument, 'video.mp4');
    let currentSize = 0;
    let lastProgress;

    mediaStorage.read(videoDocument, 'video.mp4')
      .on('data', (data) => {
        currentSize += data.length;

        const progress = Math.round((currentSize * 100) / totalSize);
        if (progress !== lastProgress && progress % 5 === 0) {
          console.log('Downloaded', progress, '% (', currentSize, '/', totalSize, ')');
          lastProgress = progress;
        }
      })
      .pipe(videoStream)
      .on('finish', () => {
        videoStream.end();
        console.log('write complete');
        callback(null);
      })
      .on('error', (err) => {
        videoStream.end();
        console.log('error while writing', err);
        callback(err);
      });
  },
  // extract video metadata
  (callback) => {
    ffmpeg.ffprobe(inputFilename, (err, metadata) => {
      if (!err) {
        videoDocument.metadata = metadata;
        console.log('Extracted video metadata', videoDocument);
      }
      callback(err);
    });
  },
  // persist the videoDocument with its metadata
  (callback) => {
    mediaStorage.insert(videoDocument, (err, body) => {
      if (err) {
        callback(err);
      } else {
        videoDocument._rev = body.rev;
        callback(null);
      }
    });
  },
  // extract the audio
  (callback) => {
    ffmpeg()
      .input(inputFilename)
      .outputOptions([
        '-qscale:a',
        '3',
        '-acodec',
        'vorbis',
        '-map',
        'a',
        '-strict',
        '-2',
        // get only first n seconds
        '-ss 0',
        `-t ${extractOptions.speechDuration}`,
        // force dual channel audio as vorbis encoder only supports 2 channels
        '-ac',
        '2'
      ])
      .output(`${workingDirectory.name}/audio.ogg`)
      .on('progress', (progress) => {
        console.log(`Exporting audio: ${Math.round(progress.percent)}% done`);
      })
      .on('error', (err) => {
        console.log('Audio export', err);
        callback(err);
      })
      .on('end', () => {
        callback(null);
      })
      .run();
  },
  // create a new "audio" document
  (callback) => {
    const audioDocument = {
      type: 'audio',
      video_id: videoDocument._id,
      language_model: videoDocument.language_model
    };
    mediaStorage.insert(audioDocument, (err, insertedDoc) => {
      if (err) {
        callback(err);
      } else {
        audioDocument._id = insertedDoc.id;
        audioDocument._rev = insertedDoc.rev;
        callback(null, audioDocument);
      }
    });
  },
  // persist the audio attachment with the video
  (audioDocument, callback) => {
    console.log('Uploading audio...');
    fs.createReadStream(`${workingDirectory.name}/audio.ogg`).pipe(
      mediaStorage.attach(audioDocument, 'audio.ogg', 'audio/ogg', (attachErr, attachedDoc) => {
        fs.unlink(`${workingDirectory.name}/audio.ogg`);
        if (attachErr) {
          console.log('Audio upload failed', attachErr);
          callback(attachErr);
        } else {
          console.log('Audio upload completed', attachedDoc.id);
          callback(null);
        }
      }
    ));
  },
  // split frames
  (callback) => {
    const fps = getFps(videoDocument.metadata.streams[0].duration);
    console.log('FPS', fps);

    ffmpeg()
      .input(inputFilename)
      .outputOptions([
        '-filter:v',
        `fps=fps=${fps}`
      ])
      .output(`${framesDirectory}/%0d.jpg`)
      .on('progress', (progress) => {
        console.log(`Processed ${progress.frames} frames`);
      })
      .on('error', (err) => {
        console.log('split frames', err);
        callback(err);
      })
      .on('end', () => {
        callback(null);
      })
      .run();
  },
  // persist frames
  (callback) => {
    const fps = getFps(videoDocument.metadata.streams[0].duration);
    const timeBetweenFrame = 1 / eval(fps); // eslint-disable-line no-eval

    fs.readdir(framesDirectory, (err, files) => {
      const uploadFrames = [];
      files.forEach((file) => {
        uploadFrames.push((uploadCallback) => {
          console.log('Persist', file);
          const frameDocument = {
            type: 'image',
            createdAt: new Date(),
            video_id: videoDocument._id,
            frame_number: parseInt(file, 10),
            frame_timecode: (parseInt(file, 10) - 1) * timeBetweenFrame
          };
          createDocument(frameDocument, 'image.jpg', 'image/jpeg', `${framesDirectory}/${file}`, uploadCallback);
        });
      });

      // keep track of the number of frames we extracted
      videoDocument.frame_count = uploadFrames.length;

      async.parallelLimit(uploadFrames, 5, (uploadErr) => {
        callback(uploadErr);
      });
    });
  },
  // persist the frame count
  (callback) => {
    mediaStorage.insert(videoDocument, (err, body) => {
      if (err) {
        callback(err);
      } else {
        videoDocument._rev = body.rev;
        callback(null);
      }
    });
  },
  // pick one frame as preview for the video
  (callback) => {
    fs.readdir(framesDirectory, (err, files) => {
      // use the frame in the middle
      const candidate = files[Math.ceil(files.length / 2)];

      console.log(`Candidate is ${framesDirectory}/${candidate}`);
      // convert it to the right size
      ffmpeg()
        .input(`${framesDirectory}/${candidate}`)
        .outputOptions([
          `-vf scale=${extractOptions.videoThumbnailSize}:-1`
        ])
        .output(`${workingDirectory.name}/thumbnail.jpg`)
        .on('error', (ffErr) => {
          console.log('Error processing thumbnail');
          callback(ffErr);
        })
        .on('end', () => {
          console.log('End of thumbnail processing');
          callback(null);
        })
        .run();
    });
  },
  // attach it to the video
  (callback) => {
    console.log('Attaching thumbnail to video');
    fs.readFile(`${workingDirectory.name}/thumbnail.jpg`, (err, data) => {
      mediaStorage.attachFile(videoDocument, 'thumbnail.jpg', data, 'image/jpeg',
        (attachErr, body) => {
          console.log('Video thumbnail result', body);
          if (attachErr) {
            console.log(attachErr.statusCode, attachErr.request);
            callback(attachErr);
          } else {
            callback(null, body);
          }
        });
    });
  }], (err) => {
  if (err) {
    console.log('Waterfall failed with', err);
  } else {
    console.log('Waterfall completed successfully');
  }

  console.log('Removing temp directory');
  rimraf.sync(workingDirectory.name);
});

function createDocument(frameDocument, attachmentName,
  attachmentMimetype, attachmentFile, callback) {
  console.log('Persisting', frameDocument.type);
  mediaStorage.insert(frameDocument, (err, body) => {
    if (err) {
      console.log('error saving image', err);
      callback(err);
    } else {
      frameDocument._id = body.id;
      frameDocument._rev = body.rev;
      console.log('Created new document', frameDocument);

      fs.readFile(attachmentFile, (rErr, data) => {
        mediaStorage.attachFile(frameDocument, attachmentName, data, attachmentMimetype,
          (aErr, aBody) => {
            console.log('Upload completed', aBody);
            if (aErr) {
              console.log(aErr.statusCode, aErr.request);
              callback(aErr);
            } else {
              callback(null);
            }
          });
      });
    }
  });
}
