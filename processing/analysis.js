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
 * It expects the following parameters as attributes of "args"
 * - cloudantUrl: "https://username:password@host"
 * - cloudantDbName: "openwhisk-darkvision"
 * - watsonApiKey: "123456"
 * - doc: "image document in cloudant"
 */
function main(args) {
  return new Promise(function(resolve, reject) {
    mainImpl(args, function(err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * @param mainCallback(err, analysis)
 */
function mainImpl(args, mainCallback) {
  var fs = require('fs')
  var request = require('request')

  var startTime = (new Date).getTime();

  if (args.hasOwnProperty("doc")) {
    var imageDocumentId = args.doc._id;
    console.log("[", imageDocumentId, "] Processing image.jpg from document");
    var cloudant = require("cloudant")({
      url: args.cloudantUrl,
      plugin: 'retry',
      retryAttempts: 10,
      retryTimeout: 500
    });
    var visionDb = cloudant.db.use(args.cloudantDbName);

    // use image id to build a unique filename
    var fileName = imageDocumentId + "-image.jpg";

    var async = require('async')
    async.waterfall([
      // get the image document from the db
      function (callback) {
        visionDb.get(imageDocumentId, {
          include_docs: true
        }, function (err, image) {
          callback(err, image);
        });
      },
      // get the image binary
      function (image, callback) {
        visionDb.attachment.get(image._id, "image.jpg").pipe(fs.createWriteStream(fileName))
          .on("finish", function () {
            callback(null, image);
          })
          .on("error", function (err) {
            callback(err);
          });
      },
      // trigger the analysis on the image file
      function (image, callback) {
        processImage(args, fileName, function (err, analysis) {
          if (err) {
            callback(err);
          } else {
            callback(null, image, analysis);
          }
        });
      },
      // write result in the db
      function (image, analysis, callback) {
        image.analysis = analysis
        visionDb.insert(image, function (err, body, headers) {
          if (err) {
            callback(err);
          } else {
            callback(null, analysis);
          }
        });
      }
    ], function (err, analysis) {
      var durationInSeconds = ((new Date).getTime() - startTime) / 1000;

      if (err) {
        console.log("[", imageDocumentId, "] KO (", durationInSeconds, "s)", err);
        mainCallback(err);
      } else {
        console.log("[", imageDocumentId, "] OK (", durationInSeconds, "s)");
        mainCallback(null, analysis);
      }
    });
    return true;
  } else {
    console.log("Parameter 'doc' not found", args);
    mainCallback("Parameter 'doc' not found");
    return false;
  }
}

/**
 * Prepares and analyzes the image.
 * processCallback = function(err, analysis);
 */
function processImage(args, fileName, processCallback) {
  prepareImage(fileName, function (prepareErr, prepareFileName) {
    if (prepareErr) {
      processCallback(prepareErr, null);
    } else {
      analyzeImage(args, prepareFileName, function (err, analysis) {
        var fs = require('fs');
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
  var
    fs = require('fs'),
    async = require('async'),
    gm = require('gm').subClass({
      imageMagick: true
    });

  async.waterfall([
    function (callback) {
      // Retrieve the file size
      fs.stat(fileName, function (err, stats) {
        if (err) {
          callback(err);
        } else {
          callback(null, stats);
        }
      });
    },
    // Check if size is OK
    function (fileStats, callback) {
      if (fileStats.size > 900 * 1024) {
        // Resize the file
        gm(fileName).define("jpeg:extent=900KB").write(fileName + ".jpg",
          function (err) {
            if (err) {
              callback(err);
            } else {
              // Process the modified file
              callback(null, fileName + ".jpg");
            }
          });
      } else {
        callback(null, fileName);
      }
    }
  ], function (err, fileName) {
    prepareCallback(err, fileName);
  });
}

/**
 * Analyzes the image stored at fileName with the callback onAnalysisComplete(err, analysis).
 * analyzeCallback = function(err, analysis);
 */
function analyzeImage(args, fileName, analyzeCallback) {
  var
    request = require('request'),
    async = require('async'),
    fs = require('fs'),
    gm = require('gm').subClass({
      imageMagick: true
    }),
    analysis = {};

  async.parallel([
    function (callback) {
        // Write down meta data about the image
        gm(fileName).size(function (err, size) {
          if (err) {
            console.log("Image size", err);
          } else {
            analysis.size = size;
          }
          callback(null);
        });
    },
    function (callback) {
        // Call Face Detection passing the image in the request
        // http://www.ibm.com/watson/developercloud/visual-recognition/api/v3/?curl#detect_faces
        fs.createReadStream(fileName).pipe(
          request({
              method: "POST",
              url: "https://gateway-a.watsonplatform.net/visual-recognition/api/v3/detect_faces" +
                "?api_key=" + args.watsonApiKey +
                "&version=2016-05-20",
              headers: {
                'Content-Length': fs.statSync(fileName).size
              },
              json: true

            },
            function (err, response, body) {
              if (err) {
                console.log("Face Detection", err);
              } else if (body.images && body.images.length > 0) {
                analysis.face_detection = body.images[0].faces;
              }
              callback(null);
            }));
    },
    function (callback) {
        // Call Classify passing the image in the request
        // http://www.ibm.com/watson/developercloud/visual-recognition/api/v3/?curl#classify_an_image
        fs.createReadStream(fileName).pipe(
          request({
              method: "POST",
              url: "https://gateway-a.watsonplatform.net/visual-recognition/api/v3/classify" +
                "?api_key=" + args.watsonApiKey +
                "&version=2016-05-20",
              headers: {
                'Content-Length': fs.statSync(fileName).size
              },
              json: true

            },
            function (err, response, body) {
              if (err) {
                console.log("Image Keywords", err);
              } else if (body.images && body.images.length > 0) {
                analysis.image_keywords = body.images[0].classifiers[0].classes;
              }
              callback(null);
            }));
    }
  ],
    function (err, result) {
      analyzeCallback(err, analysis);
    }
  )
}
