/**
 * Copyright 2017 IBM Corp. All Rights Reserved.
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

/**
 * Called by Whisk.
 *
 * It expects the following parameters as attributes of 'args'
 * - cloudantUrl: "https://username:password@host"
 * - cloudantDbName: "openwhisk-darkvision"
 * - sttUrl: "https://watson"
 * - sttUsername: 'username'
 * - sttPassword: 'password'
 * - doc: "audio document in cloudant"
 */
function main(args) {
  return new Promise((resolve, reject) => {
    mainImpl(args, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

exports.main = main;

/**
 * @param mainCallback(err, analysis)
 */
function mainImpl(args, mainCallback) {
  const fs = require('fs');
  const startTime = (new Date()).getTime();

  if (args.doc) {
    const audioDocumentId = args.doc._id;
    console.log('[', audioDocumentId, '] Processing audio.ogg from document');

    // use id to build a unique filename
    const fileName = `${audioDocumentId}-audio.ogg`;

    const mediaStorage = require('./lib/cloudantstorage')({
      cloudantUrl: args.cloudantUrl,
      cloudantDbName: args.cloudantDbName
    });

    const async = require('async');
    async.waterfall([
      // get the document from the db
      (callback) => {
        mediaStorage.get(audioDocumentId, (err, audio) => {
          callback(err, audio);
        });
      },
      // get the audio binary
      (audio, callback) => {
        console.log('Retrieving audio file');
        mediaStorage.read(audio, 'audio.ogg').pipe(fs.createWriteStream(fileName))
          .on('finish', () => {
            callback(null, audio);
          })
          .on('error', (err) => {
            callback(err);
          });
      },
      // trigger the analysis on the audio file
      (audio, callback) => {
        processAudio(args, audio, fileName, (err, transcript) => {
          if (err) {
            callback(err);
          } else {
            callback(null, audio, transcript);
          }
        });
      },
      // write result in the db
      (audio, transcript, callback) => {
        audio.transcript = transcript;
        mediaStorage.insert(audio, (err) => {
          if (err) {
            callback(err);
          } else {
            callback(null, transcript);
          }
        });
      }
    ], (err, transcript) => {
      const durationInSeconds = ((new Date()).getTime() - startTime) / 1000;

      if (err) {
        console.log('[', audioDocumentId, '] KO (', durationInSeconds, 's)', err);
        mainCallback(err);
      } else {
        console.log('[', audioDocumentId, '] OK (', durationInSeconds, 's)');
        mainCallback(null, transcript);
      }
    });
    return true;
  }

  console.log('Parameter "doc" not found', args);
  mainCallback('Parameter "doc" not found');
  return false;
}

/**
 * Prepares and analyzes the audio.
 * processCallback = function(err, transcript);
 */
function processAudio(args, audio, fileName, processCallback) {
  const SpeechToTextV1 = require('watson-developer-cloud/speech-to-text/v1');
  const stt = new SpeechToTextV1({
    username: args.sttUsername,
    password: args.sttPassword
  });
  const fs = require('fs');

  console.log(`Calling Speech to Text with ${audio.language_model || 'default'} model...`);
  try {
    stt.recognize({
      audio: fs.createReadStream(fileName),
      content_type: 'audio/ogg;codecs=opus',
      timestamps: true,
      word_alternatives_threshold: 0.9,
      continuous: true,
      smart_formatting: true,
      model: audio.language_model || undefined
    }, (err, transcript) => {
      processCallback(err, transcript);
    });
  } catch (error) {
    console.log(error);
    processCallback(error);
  }
}
