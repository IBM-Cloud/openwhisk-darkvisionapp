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
 * - alchemyApiKey: '123'
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
  const startTime = (new Date()).getTime();

  if (args.doc) {
    const audioDocumentId = args.doc._id;
    console.log('[', audioDocumentId, '] Processing audio transcript from document');

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
      // trigger the analysis on the audio file
      (audio, callback) => {
        const fullText = audio.transcript.results.reduce((text, transcript) =>
          `${text}${transcript.alternatives[0].transcript}. `
        , '');
        processTranscript(args, fullText, (err, analysis) => {
          callback(err, audio, analysis);
        });
      },
      // write result in the db
      (audio, analysis, callback) => {
        audio.analysis = analysis;
        mediaStorage.insert(audio, (err) => {
          if (err) {
            callback(err);
          } else {
            callback(null, analysis);
          }
        });
      }
    ], (err, analysis) => {
      const durationInSeconds = ((new Date()).getTime() - startTime) / 1000;

      if (err) {
        console.log('[', audioDocumentId, '] KO (', durationInSeconds, 's)', err);
        mainCallback(err);
      } else {
        console.log('[', audioDocumentId, '] OK (', durationInSeconds, 's)');
        mainCallback(null, analysis);
      }
    });
    return true;
  }

  console.log('Parameter "doc" not found', args);
  mainCallback('Parameter "doc" not found');
  return false;
}

/**
 * Sends the transcript to different text processing service
 */
function processTranscript(args, text, processCallback) {
  const async = require('async');
  const analysis = {
  };
  const AlchemyLanguageV1 = require('watson-developer-cloud/alchemy-language/v1');
  const alchemyLanguage = new AlchemyLanguageV1({
    api_key: args.alchemyApiKey
  });
  async.parallel([
    // entities
    (callback) => {
      alchemyLanguage.entities({ text }, (err, response) => {
        if (err) {
          console.log('Alchemy Language entities', err);
        } else {
          analysis.entities = response.entities;
        }
        callback(null);
      });
    },
    // concepts
    (callback) => {
      alchemyLanguage.concepts({
        text,
        knowledgeGraph: 1
      }, (err, response) => {
        if (err) {
          console.log('Alchemy Language concepts', err);
        } else {
          analysis.concepts = response.concepts;
        }
        callback(null);
      });
    },
    // document emotion
    (callback) => {
      alchemyLanguage.emotion({ text }, (err, response) => {
        if (err) {
          console.log('Alchemy Language emotion', err);
        } else {
          analysis.docEmotions = response.docEmotions;
        }
        callback(null);
      });
    },
  ], (err) => {
    processCallback(err, analysis);
  });
}
