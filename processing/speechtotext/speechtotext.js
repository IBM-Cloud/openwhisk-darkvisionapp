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
  * - sttCallbackSecret: 'asecret'
  * - sttCallbackUrl: 'https://host/stt/results'
  * - doc: 'audio document in cloudant'
  */
function main(args) {
  // we are being challenged by Watson Speech To Text through HTTP
  // verify the signature against our secret and reply
  if (args.__ow_method === 'get' && args.challenge_string) {
    return onChallengeRequest(
      args.challenge_string,
      args.sttCallbackSecret,
      args.__ow_headers['x-callback-signature']
    );
  }

  // we are receiving transcripts from Speech To Text
  if (args.__ow_method === 'post' &&
      args.__ow_headers['x-callback-signature'] &&
      args.user_token && args.results) {
    return onResultsReceived(args);
  }

  // we should not reach this point
  if (args.__ow_method) {
    console.log('[OK] ignored HTTP verb', args.__ow_method);
    return { ok: false };
  }

  // other cases come from changelistener calling the audio processing
  return submitRecognition(args);
}

exports.main = main;

function onChallengeRequest(challenge, secret, signature) {
  console.log('Replying to a challenge request from Watson Speech to Text...');
  const crypto = require('crypto');
  const hmac = crypto.createHmac('SHA1', secret);
  hmac.update(challenge);
  if (hmac.digest('base64') === signature) {
    console.log('[OK] Challenge accepted!');
    return {
      headers: {
        'Content-Type': 'text/plain'
      },
      body: challenge
    };
  }

  console.log('[KO] Signature does not match');
  return {
    code: 500,
    headers: {
      'Content-Type': 'text/plain'
    },
    body: 'Bad signature'
  };
}

function onResultsReceived(args) {
  return new Promise((resolve, reject) => {
    onResultsReceivedImpl(args, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function onResultsReceivedImpl(args, resultsReceivedCallback) {
  const audioDocumentId = args.user_token;
  console.log('Received results for audio', audioDocumentId);

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
    // persist the transcript in the db
    (audio, callback) => {
      audio.transcript = args.results[0];
      mediaStorage.insert(audio, (err) => {
        if (err) {
          callback(err);
        } else {
          callback(null);
        }
      });
    }
  ], (err) => {
    if (err) {
      console.log('[', audioDocumentId, '] KO', err);
      resultsReceivedCallback(err);
    } else {
      console.log('[', audioDocumentId, '] OK - updated audio with transcript');
      resultsReceivedCallback(null, { code: 200, body: 'OK' });
    }
  });
}

function submitRecognition(args) {
  return new Promise((resolve, reject) => {
    submitRecognitionImpl(args, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * @param mainCallback(err, ok)
 */
function submitRecognitionImpl(args, mainCallback) {
  const fs = require('fs');

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
        submitSpeechToTextRequest(
          args.sttUrl, args.sttUsername, args.sttPassword, args.sttCallbackUrl,
          audio, fileName, (err) => {
            if (err) {
              callback(err);
            } else {
              callback(null);
            }
          });
      }
    ], (err) => {
      if (err) {
        console.log('[', audioDocumentId, '] KO', err);
        mainCallback(err);
      } else {
        console.log('[', audioDocumentId, '] OK - submitted for processing');
        mainCallback(null, { ok: true });
      }
    });
    return true;
  }

  console.log('Parameter "doc" not found', args);
  mainCallback('Parameter "doc" not found');
  return false;
}

/**
 * Submits an asynchronous request to Watson Speech To Text
 * processCallback = function(err);
 */
function submitSpeechToTextRequest(
  sttUrl, sttUsername, sttPassword, sttCallbackUrl,
  audio, fileName, processCallback) {
  const request = require('request');
  const fs = require('fs');

  console.log(`Calling Speech to Text with ${audio.language_model || 'default'} model...`);
  let apiUrl = `${sttUrl}/v1/recognitions?`;
  apiUrl += `callback_url=${sttCallbackUrl}&user_token=${audio._id}`;
  apiUrl += '&timestamps=true&word_alternatives_threshold=0.9&continuous=true&smart_formatting=true';
  apiUrl += '&events=recognitions.started,recognitions.completed_with_results,recognitions.failed';
  apiUrl += '&results_ttl=5'; // delete results from Watson STT after 5min
  if (audio.language_model) {
    apiUrl += `&model=${audio.language_model}`;
  }
  console.log('Submitting', apiUrl);
  fs.createReadStream(fileName).pipe(request({
    method: 'POST',
    url: apiUrl,
    auth: {
      username: sttUsername,
      password: sttPassword
    },
    headers: {
      'Content-Type': 'audio/ogg;codecs=opus'
    }
  }, (err) => {
    processCallback(err);
  }));
}
