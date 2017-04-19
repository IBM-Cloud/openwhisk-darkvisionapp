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

/**
 * Called by Whisk.
 *
 * It expects the following parameters as attributes of 'args'
 * - cloudantUrl: "https://username:password@host"
 * - cloudantDbName: "openwhisk-darkvision"
 * - watsonApiKey: "123456"
 * - doc: "image document in cloudant"
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
    const imageDocumentId = args.doc._id;
    console.log('[', imageDocumentId, '] Processing image.jpg from document');

    // use image id to build a unique filename
    const fileName = `${imageDocumentId}-image.jpg`;

    const mediaStorage = require('./lib/cloudantstorage')({
      cloudantUrl: args.cloudantUrl,
      cloudantDbName: args.cloudantDbName
    });

    const async = require('async');
    async.waterfall([
      // get the image document from the db
      (callback) => {
        mediaStorage.get(imageDocumentId, (err, image) => {
          callback(err, image);
        });
      },
      // get the image binary
      (image, callback) => {
        mediaStorage.read(image, 'image.jpg', {
          // as we analyze images in batch it means, a lot of load on Cloudant
          // so we may get rate-limited if using Cloudant for attachments
          useRetry: true
        }).pipe(fs.createWriteStream(fileName))
          .on('finish', () => {
            callback(null, image);
          })
          .on('error', (err) => {
            callback(err);
          });
      },
      // trigger the analysis on the image file
      (image, callback) => {
        processImage(args, fileName, (err, analysis) => {
          if (err) {
            callback(err);
          } else {
            callback(null, image, analysis);
          }
        });
      },
      // write result in the db
      (image, analysis, callback) => {
        image.analysis = analysis;
        mediaStorage.insert(image, (err) => {
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
        console.log('[', imageDocumentId, '] KO (', durationInSeconds, 's)', err);
        mainCallback(err);
      } else {
        console.log('[', imageDocumentId, '] OK (', durationInSeconds, 's)');
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
 * Prepares and analyzes the image.
 * processCallback = function(err, analysis);
 */
function processImage(args, fileName, processCallback) {
  prepareImage(fileName, (prepareErr, prepareFileName) => {
    if (prepareErr) {
      processCallback(prepareErr, null);
    } else {
      analyzeImage(args, prepareFileName, (err, analysis) => {
        const fs = require('fs');
        fs.unlink(prepareFileName);
        processCallback(err, analysis);
      });
    }
  });
}

/**
 * Prepares the image, resizing it if it is too big for Watson.
 * prepareCallback = function(err, fileName);
 */
function prepareImage(fileName, prepareCallback) {
  const fs = require('fs');
  const async = require('async');
  const gm = require('gm').subClass({
    imageMagick: true
  });

  async.waterfall([
    (callback) => {
      // Retrieve the file size
      fs.stat(fileName, (err, stats) => {
        if (err) {
          callback(err);
        } else {
          callback(null, stats);
        }
      });
    },
    // Check if size is OK
    (fileStats, callback) => {
      if (fileStats.size > 900 * 1024) {
        // Resize the file
        gm(fileName).define('jpeg:extent=900KB').write(`${fileName}.jpg`,
          (err) => {
            if (err) {
              callback(err);
            } else {
              // Process the modified file
              callback(null, `${fileName}.jpg`);
            }
          });
      } else {
        callback(null, fileName);
      }
    }
  ], (err, resultFileName) => {
    prepareCallback(err, resultFileName);
  });
}

/**
 * Analyzes the image stored at fileName with the callback onAnalysisComplete(err, analysis).
 * analyzeCallback = function(err, analysis);
 */
function analyzeImage(args, fileName, analyzeCallback) {
  const request = require('request');
  const async = require('async');
  const fs = require('fs');
  const gm = require('gm').subClass({
    imageMagick: true
  });
  const analysis = {};

  async.parallel([
    (callback) => {
      // Write down meta data about the image
      gm(fileName).size((err, size) => {
        if (err) {
          console.log('Image size', err);
        } else {
          analysis.size = size;
        }
        callback(null);
      });
    },
    (callback) => {
      // Call Face Detection passing the image in the request
      // http://www.ibm.com/watson/developercloud/visual-recognition/api/v3/?curl#detect_faces
      fs.createReadStream(fileName).pipe(
        request({
          method: 'POST',
          url: 'https://gateway-a.watsonplatform.net/visual-recognition/api/v3/detect_faces' + // eslint-disable-line
            '?api_key=' + args.watsonApiKey +
            '&version=2016-05-20',
          headers: {
            'Content-Length': fs.statSync(fileName).size
          },
          json: true
        }, (err, response, body) => {
          if (err) {
            console.log('Face Detection', err);
          } else if (body.images && body.images.length > 0) {
            // sort the faces from left to right
            analysis.face_detection = body.images[0].faces ?
              body.images[0].faces.sort((face1, face2) =>
                face1.face_location.left - face2.face_location.left) :
              [];
          }
          callback(null);
        }));
    },
    (callback) => {
      // Call Classify passing the image in the request
      // http://www.ibm.com/watson/developercloud/visual-recognition/api/v3/?curl#classify_an_image
      fs.createReadStream(fileName).pipe(
        request({
          method: 'POST',
          url: 'https://gateway-a.watsonplatform.net/visual-recognition/api/v3/classify' + // eslint-disable-line
            '?api_key=' + args.watsonApiKey +
            '&version=2016-05-20',
          headers: {
            'Content-Length': fs.statSync(fileName).size
          },
          json: true
        }, (err, response, body) => {
          if (err) {
            console.log('Image Keywords', err);
          } else if (body.images && body.images.length > 0) {
            analysis.image_keywords = body.images[0].classifiers[0].classes;
          }
          callback(null);
        }));
    }
  ],
  (err) => {
    analyzeCallback(err, analysis);
  });
}
